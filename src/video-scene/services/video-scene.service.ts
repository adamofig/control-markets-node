import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VideoSceneEntity, VideoSceneDocument } from '../schemas/video-scene.schema';
import { MongoService, EntityCommunicationService } from '@dataclouder/nest-mongo';
import { HttpService } from '@nestjs/axios';
import { CloudStorageService, IStorageAsset, StorageAssetService } from '@dataclouder/nest-storage';
import { firstValueFrom } from 'rxjs';
import { IAuditable } from '@dataclouder/nest-core';
import { VideoSceneEventsService } from './video-scene-events.service';

/**
 * Reconoce un MP4 producido por `control-render`. Sirve para detectar los renders viejos que
 * quedaron guardados en `videoStorage` (el campo del fondo) antes de existir `renderStorage`.
 */
export function isRenderedAsset(asset: any): boolean {
  if (!asset?.storage?.url) return false;
  const provider = asset?.generationMetadata?.provider;
  const path: string = asset?.storage?.path || '';
  return provider === 'remotion' || path.startsWith('rendered-scenes/');
}

@Injectable()
export class VideoSceneService extends EntityCommunicationService<VideoSceneDocument> {
  private readonly logger = new Logger(VideoSceneService.name);
  private readonly renderServerUrl = process.env.RENDER_SERVER_URL || 'http://localhost:8124';

  constructor(
    @InjectModel(VideoSceneEntity.name)
    videoSceneModel: Model<VideoSceneDocument>,
    mongoService: MongoService,
    private readonly httpService: HttpService,
    private readonly cloudStorageService: CloudStorageService,
    private readonly storageAssetService: StorageAssetService,
    private readonly videoSceneEventsService: VideoSceneEventsService,
  ) {
    super(videoSceneModel, mongoService);
  }

  emitProgress(sceneId: string, progressData: any) {
    this.videoSceneEventsService.emit(sceneId, {
      event: 'progress',
      payload: progressData,
    });
  }

  async renderScene(id: string, orgId: string | undefined, auditable: IAuditable): Promise<VideoSceneEntity> {
    this.logger.log(`Starting render process for scene ID: ${id}`);
    const scene = await this.findOne(id);
    if (!scene) {
      this.logger.error(`Video scene with ID ${id} not found`);
      throw new NotFoundException(`Video scene with ID ${id} not found`);
    }

    // Update status to rendering
    this.logger.log(`Updating status for scene ID ${id} to 'rendering'`);
    await this.update(id, { status: 'rendering', auditable });

    // Escenas renderizadas antes de que existiera `renderStorage` tienen el MP4 final metido en
    // `videoStorage`; `control-render` lo tomaría como fondo y se auto-incrustaría. Se descarta del
    // payload y se limpia el campo al guardar.
    const renderInput: any = typeof (scene as any).toObject === 'function' ? (scene as any).toObject() : { ...scene };
    const hadLegacyRender = isRenderedAsset(renderInput.videoStorage);
    if (hadLegacyRender) {
      this.logger.warn(`Scene ${id} carries a legacy render inside videoStorage; excluding it from the render input`);
      delete renderInput.videoStorage;
    }

    try {
      // Call render microservice
      this.logger.log(`Calling render microservice at ${this.renderServerUrl}/render for scene ID: ${id}`);
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.renderServerUrl}/render`,
          { scene: renderInput },
          { responseType: 'arraybuffer' }
        )
      );

      const fileBuffer = Buffer.from(response.data);
      this.logger.log(`Received rendered buffer from microservice for scene ID ${id} (${fileBuffer.length} bytes)`);

      const renderStorage = await this.saveRenderAsStorageAsset(scene, id, orgId, fileBuffer, auditable);

      // Set final status to ready
      this.logger.log(`Updating scene ID ${id} status to 'ready' with render asset ID ${renderStorage.id}`);
      const updatedScene = await this.update(id, {
        status: 'ready',
        renderStorage,
        ...(hadLegacyRender ? { videoStorage: null } : {}),
        auditable,
      });

      // Emit complete event to SSE subscribers
      this.videoSceneEventsService.emit(id, {
        event: 'complete',
        payload: updatedScene,
      });

      return updatedScene;

    } catch (error: any) {
      this.logger.error(`Failed to render scene ${id}: ${error.message || error}`, error.stack);
      await this.update(id, { status: 'failed', auditable });

      // Emit failed event to SSE subscribers
      this.videoSceneEventsService.emit(id, {
        event: 'failed',
        payload: { error: error.message || 'Rendering failed' },
      });

      throw error;
    }
  }

  /**
   * Sube el MP4 renderizado a GCS y lo registra en `storage_assets` — el mismo camino que sigue
   * cualquier media generada por IA (bucket público + documento con `orgId`, `type`, `storage` y
   * `generationMetadata`), para que el render aparezca en el listado de Storage Assets como el resto.
   *
   * Devuelve la referencia suave (snapshot) que se guarda dentro de la escena, con la misma forma que
   * `imageStorage` / `speechStorage`: `{ id, type, storage, generationMetadata }`.
   */
  private async saveRenderAsStorageAsset(
    scene: VideoSceneEntity,
    id: string,
    orgId: string | undefined,
    fileBuffer: Buffer,
    auditable: IAuditable,
  ): Promise<Partial<IStorageAsset> & { id: string }> {
    const bucketName = process.env.STORAGE_BUCKET;
    const filename = `rendered-scenes/${id}-${Date.now()}.mp4`;

    this.logger.log(`Uploading rendered scene ID ${id} to bucket '${bucketName}' as '${filename}'`);
    const uploadResult = await this.cloudStorageService.uploadFileAndMakePublic(bucketName, filename, fileBuffer, 'video/mp4');
    this.logger.log(`Uploaded rendered scene ID ${id} successfully. URL: ${uploadResult.url}`);

    this.logger.log(`Saving storage asset document in MongoDB for scene ID ${id}`);
    const storageAsset = await this.storageAssetService.save({
      orgId, // Link the asset to the organization
      type: 'video',
      name: scene.name ? `${scene.name} (Render)` : `Scene Render`,
      description: scene.description || `Rendered video for Scene`,
      storage: {
        url: uploadResult.url,
        path: uploadResult.path,
        bucket: uploadResult.bucket,
        provider: uploadResult.provider || 'gcs',
        name: `${id}.mp4`,
        size: fileBuffer.length,
        type: 'video/mp4',
        auditable,
      },
      generationMetadata: {
        provider: 'remotion',
        model: 'control-render',
        prompt: scene.dialog?.content || '',
        // Contexto del render: permite reproducir/diagnosticar el MP4 sin volver a abrir la escena.
        sceneId: id,
        aspectRatio: scene.aspectRatio,
        durationSeconds: scene.durationSec,
        mediaType: scene.mediaType,
        generatedAt: new Date().toISOString(),
      },
      auditable,
    });

    const assetId = (storageAsset as any)._id ? (storageAsset as any)._id.toString() : storageAsset.id;
    this.logger.log(`Storage asset saved in MongoDB with ID ${assetId} for scene ID ${id}`);

    return {
      _id: assetId,
      id: assetId,
      type: 'video',
      storage: storageAsset.storage,
      generationMetadata: storageAsset.generationMetadata,
    };
  }

  async renderSceneOnly(scene: any): Promise<Buffer> {
    const sceneInfo = scene?.id || scene?._id || `scene:${scene?.name || 'unnamed'}`;
    this.logger.log(`Starting renderSceneOnly (preview/buffer only) for scene: ${sceneInfo}`);
    try {
      this.logger.log(`Calling render microservice at ${this.renderServerUrl}/render for preview`);
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.renderServerUrl}/render`,
          { scene },
          { responseType: 'arraybuffer' }
        )
      );
      const fileBuffer = Buffer.from(response.data);
      this.logger.log(`Successfully rendered scene only for ${sceneInfo} (${fileBuffer.length} bytes)`);
      return fileBuffer;
    } catch (error: any) {
      this.logger.error(`Failed to preview render scene only for ${sceneInfo}: ${error.message || error}`, error.stack);
      throw error;
    }
  }
}
