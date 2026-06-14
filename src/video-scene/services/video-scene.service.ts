import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VideoSceneEntity, VideoSceneDocument } from '../schemas/video-scene.schema';
import { MongoService, EntityCommunicationService } from '@dataclouder/nest-mongo';
import { HttpService } from '@nestjs/axios';
import { CloudStorageService, StorageAssetService } from '@dataclouder/nest-storage';
import { firstValueFrom } from 'rxjs';
import { IAuditable } from '@dataclouder/nest-core';
import { VideoSceneEventsService } from './video-scene-events.service';

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

    try {
      // Call render microservice
      this.logger.log(`Calling render microservice at ${this.renderServerUrl}/render for scene ID: ${id}`);
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.renderServerUrl}/render`,
          { scene },
          { responseType: 'arraybuffer' }
        )
      );

      const fileBuffer = Buffer.from(response.data);
      this.logger.log(`Received rendered buffer from microservice for scene ID ${id} (${fileBuffer.length} bytes)`);
      const bucketName = process.env.STORAGE_BUCKET;
      const filename = `rendered-scenes/${id}-${Date.now()}.mp4`;

      // Upload rendered MP4 to storage
      this.logger.log(`Uploading rendered scene ID ${id} to bucket '${bucketName}' as '${filename}'`);
      const uploadResult = await this.cloudStorageService.uploadFileAndMakePublic(
        bucketName,
        filename,
        fileBuffer,
        'video/mp4'
      );
      this.logger.log(`Uploaded rendered scene ID ${id} successfully. URL: ${uploadResult.url}`);

      // Create a persistent StorageAsset document in MongoDB
      this.logger.log(`Saving storage asset document in MongoDB for scene ID ${id}`);
      const storageAsset = await this.storageAssetService.save({
        orgId, // Link the asset to the organization
        type: 'video',
        name: scene.name ? `${scene.name} (Render)` : `Scene #${scene.index} Render`,
        description: scene.description || `Rendered video for Scene #${scene.index}`,
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
          generatedAt: new Date().toISOString(),
        },
        auditable,
      });

      const assetId = (storageAsset as any)._id ? (storageAsset as any)._id.toString() : storageAsset.id;
      this.logger.log(`Storage asset saved in MongoDB with ID ${assetId} for scene ID ${id}`);

      const videoStorage = {
        _id: assetId,
        id: assetId,
        type: 'video',
        storage: storageAsset.storage,
        generationMetadata: storageAsset.generationMetadata,
      };

      // Set final status to ready
      this.logger.log(`Updating scene ID ${id} status to 'ready' with video asset ID ${assetId}`);
      const updatedScene = await this.update(id, {
        status: 'ready',
        videoStorage,
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

  async renderSceneOnly(scene: any): Promise<Buffer> {
    const sceneInfo = scene?.id || scene?._id || `index:${scene?.index}`;
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
