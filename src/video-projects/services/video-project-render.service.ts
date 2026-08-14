import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { ObjectId } from 'mongodb';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { IAuditable } from '@dataclouder/nest-core';
import { CloudStorageService, IStorageAsset, StorageAssetService } from '@dataclouder/nest-storage';
import { VideoSceneDocument, VideoSceneEntity } from '../../video-scene/schemas/video-scene.schema';
import { isRenderedAsset } from '../../video-scene/services/video-scene.service';
import { VideoGeneratorService } from './video-project-generator.service';
import { VideoProjectEventsService } from './video-project-events.service';
import { IProjectRenderOptions, IProjectRenderStart, ProjectRenderMode } from '../models/video-project.models';

/**
 * Genera el **video final** de un proyecto: todas sus escenas en un solo MP4.
 *
 * Dos modos, mismo resultado guardado en `project.renderStorage`:
 * - `concat`: une los MP4 que cada escena ya tiene en `renderStorage` con FFmpeg. Segundos, sin IA
 *   ni Chromium — pero requiere que **todas** las escenas estén renderizadas y no admite
 *   transiciones ni música.
 * - `master`: manda las escenas completas a Remotion (`/render-project`) y recompone todo con
 *   transiciones y BGM. Tarda lo mismo que renderizar cada escena de nuevo.
 *
 * Corre en background como `VideoProjectPipelineService`: un render maestro son minutos, muy por
 * encima de lo que aguanta un request detrás de un proxy. El avance sale por
 * `/api/video-generator/subscribe/:id`.
 */
@Injectable()
export class VideoProjectRenderService {
  private readonly logger = new Logger(VideoProjectRenderService.name);
  private readonly renderServerUrl = process.env.RENDER_SERVER_URL || 'http://localhost:8124';
  /**
   * URL a la que `control-render` reporta avance. Tiene que ser alcanzable **desde el contenedor de
   * render**, no desde el browser: si el render corre en otra máquina, `localhost` no sirve.
   */
  private readonly progressCallbackUrl =
    process.env.PROJECT_PROGRESS_CALLBACK_URL || 'http://localhost:8121/api/video-generator/render-progress';
  /** Un render por proyecto: dos clicks no deben subir dos MP4 distintos al mismo campo. */
  private readonly running = new Set<string>();

  constructor(
    @InjectModel(VideoSceneEntity.name)
    private readonly videoSceneModel: Model<VideoSceneDocument>,
    private readonly videoGeneratorService: VideoGeneratorService,
    private readonly httpService: HttpService,
    private readonly cloudStorageService: CloudStorageService,
    private readonly storageAssetService: StorageAssetService,
    private readonly eventsService: VideoProjectEventsService,
  ) {}

  isRunning(projectId: string): boolean {
    return this.running.has(projectId);
  }

  /** Reemite hacia el SSE del proyecto el avance que manda `control-render`. */
  emitProgress(projectId: string, payload: any) {
    this.eventsService.emit(projectId, { event: 'render-progress', payload });
  }

  /**
   * Valida el proyecto y las escenas, marca la corrida y lanza el render sin esperarlo.
   * Falla rápido (y de forma sincrónica) si falta media: el usuario se entera al instante.
   */
  async startFinalRender(
    projectId: string,
    mode: ProjectRenderMode,
    orgId: string | undefined,
    auditable: IAuditable,
    options: IProjectRenderOptions = {},
  ): Promise<IProjectRenderStart> {
    if (this.running.has(projectId)) {
      throw new ConflictException('Este proyecto ya tiene un render final en curso');
    }

    const project: any = await this.videoGeneratorService.findOne(projectId);
    if (!project) throw new NotFoundException(`Video project with ID ${projectId} not found`);
    if (orgId && project.orgId && project.orgId !== orgId) {
      throw new NotFoundException(`Video project with ID ${projectId} not found`);
    }

    const scenes = await this.loadOrderedScenes(project, orgId);
    if (scenes.length === 0) {
      throw new NotFoundException('El proyecto no tiene escenas vinculadas');
    }

    if (mode === 'concat') {
      // El modo rápido no renderiza nada: si una escena no tiene MP4, no hay nada que unir.
      const missing = scenes.filter(scene => !scene?.renderStorage?.storage?.url);
      if (missing.length) {
        throw new BadRequestException(
          `No se puede unir: ${missing.length} de ${scenes.length} escenas no están renderizadas (${missing
            .map(scene => scene.name || scene._id)
            .join(', ')}). Usá "generate-all" o el modo master.`,
        );
      }
    }

    this.running.add(projectId);
    // Sin `await`: el request contesta ya y el trabajo sigue en el proceso.
    void this.run(projectId, project, scenes, mode, orgId, auditable, options);

    return { status: 'started', projectId, mode, scenes: scenes.length };
  }

  private async run(
    projectId: string,
    project: any,
    scenes: any[],
    mode: ProjectRenderMode,
    orgId: string | undefined,
    auditable: IAuditable,
    options: IProjectRenderOptions,
  ): Promise<void> {
    this.emit(projectId, 'render-start', { mode, scenes: scenes.length });
    try {
      await this.videoGeneratorService.partialUpdateFlattend(projectId, { renderStatus: 'rendering' } as any, orgId);

      const buffer = mode === 'concat' ? await this.requestConcat(projectId, project, scenes, options) : await this.requestMaster(projectId, project, scenes, options);

      this.logger.log(`Received final video for project ${projectId} (${buffer.length} bytes, mode=${mode})`);
      const renderStorage = await this.saveRenderAsStorageAsset(projectId, project, scenes, mode, orgId, buffer, auditable);

      const updated = await this.videoGeneratorService.partialUpdateFlattend(
        projectId,
        { renderStorage, renderStatus: 'ready', renderMode: mode, renderedAt: new Date().toISOString() } as any,
        orgId,
      );

      this.emit(projectId, 'render-complete', {
        mode,
        renderStorage,
        url: renderStorage.storage?.url,
        project: updated,
      });
    } catch (error: any) {
      const detail = this.describeError(error);
      this.logger.error(`Final render failed for project ${projectId} (mode=${mode}): ${detail}`, error.stack);
      await this.videoGeneratorService
        .partialUpdateFlattend(projectId, { renderStatus: 'failed' } as any, orgId)
        .catch(() => undefined);
      this.emit(projectId, 'render-failed', { mode, error: detail });
    } finally {
      this.running.delete(projectId);
    }
  }

  /** Escenas completas del proyecto, en el orden en que están enlazadas (el orden de reproducción). */
  private async loadOrderedScenes(project: any, orgId: string | undefined): Promise<any[]> {
    const refs: any[] = project.videoScene || [];
    const ids = refs.map(ref => ref?.id).filter((id: any): id is string => !!id && isValidObjectId(id));
    if (ids.length === 0) return [];

    const match: any = { _id: { $in: ids.map(id => new ObjectId(id)) } };
    if (orgId) match.orgId = orgId;

    const scenes = await this.videoSceneModel.find(match).lean().exec();
    const byId = new Map(scenes.map((scene: any) => [String(scene._id), scene]));
    return ids.map(id => byId.get(id)).filter(Boolean);
  }

  private async requestConcat(projectId: string, project: any, scenes: any[], options: IProjectRenderOptions): Promise<Buffer> {
    const videoUrls = scenes.map(scene => scene.renderStorage.storage.url);
    this.logger.log(`Calling ${this.renderServerUrl}/concat for project ${projectId} with ${videoUrls.length} clips`);

    const response = await firstValueFrom(
      this.httpService.post(
        `${this.renderServerUrl}/concat`,
        {
          projectId,
          videoUrls,
          aspectRatio: options.aspectRatio || project?.brief?.aspectRatio || scenes[0]?.aspectRatio || '9:16',
          outputName: `${projectId}-concat.mp4`,
          progressCallbackUrl: this.progressCallbackUrl,
        },
        { responseType: 'arraybuffer', timeout: Number(process.env.RENDER_CONCAT_TIMEOUT_MS || 10 * 60 * 1000) },
      ),
    );
    return Buffer.from(response.data);
  }

  private async requestMaster(projectId: string, project: any, scenes: any[], options: IProjectRenderOptions): Promise<Buffer> {
    // Igual que en el render por escena: un MP4 viejo guardado en `videoStorage` se colaría como
    // fondo y la escena se auto-incrustaría dentro de sí misma.
    const cleanScenes = scenes.map(scene => {
      if (!isRenderedAsset(scene.videoStorage)) return scene;
      const { videoStorage, ...rest } = scene;
      return rest;
    });

    this.logger.log(`Calling ${this.renderServerUrl}/render-project for project ${projectId} with ${cleanScenes.length} scenes`);
    const response = await firstValueFrom(
      this.httpService.post(
        `${this.renderServerUrl}/render-project`,
        {
          project: {
            _id: projectId,
            name: project.name,
            aspectRatio: options.aspectRatio || project?.brief?.aspectRatio || scenes[0]?.aspectRatio || '9:16',
            musicUrl: options.musicUrl || project?.assets?.audios?.bgm?.url,
            musicVolume: options.musicVolume,
            transitionType: options.transitionType ?? 'fade',
            transitionDurationSec: options.transitionDurationSec,
          },
          scenes: cleanScenes,
          outputName: `${projectId}-master.mp4`,
          progressCallbackUrl: this.progressCallbackUrl,
        },
        {
          responseType: 'arraybuffer',
          timeout: Number(process.env.RENDER_MASTER_TIMEOUT_MS || 45 * 60 * 1000),
          // El payload lleva todas las escenas con sus captions palabra por palabra.
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        },
      ),
    );
    return Buffer.from(response.data);
  }

  /**
   * Sube el MP4 final a GCS (`rendered-projects/`) y lo registra en `storage_assets`, igual que el
   * render por escena, para que aparezca en el listado de assets con su `orgId`.
   */
  private async saveRenderAsStorageAsset(
    projectId: string,
    project: any,
    scenes: any[],
    mode: ProjectRenderMode,
    orgId: string | undefined,
    fileBuffer: Buffer,
    auditable: IAuditable,
  ): Promise<Partial<IStorageAsset> & { id: string }> {
    const bucketName = process.env.STORAGE_BUCKET;
    const filename = `rendered-projects/${projectId}-${mode}-${Date.now()}.mp4`;

    this.logger.log(`Uploading final video for project ${projectId} to '${bucketName}' as '${filename}'`);
    const uploadResult = await this.cloudStorageService.uploadFileAndMakePublic(bucketName, filename, fileBuffer, 'video/mp4');

    const storageAsset = await this.storageAssetService.save({
      orgId,
      type: 'video',
      name: project.name ? `${project.name} (Video Final)` : 'Video Final del Proyecto',
      description: project.description || `Video final del proyecto (${mode})`,
      storage: {
        url: uploadResult.url,
        path: uploadResult.path,
        bucket: uploadResult.bucket,
        provider: uploadResult.provider || 'gcs',
        name: `${projectId}.mp4`,
        size: fileBuffer.length,
        type: 'video/mp4',
        auditable,
      },
      generationMetadata: {
        provider: mode === 'concat' ? 'ffmpeg' : 'remotion',
        model: 'control-render',
        // Contexto del render: permite diagnosticar el MP4 sin volver a abrir el proyecto.
        projectId,
        mode,
        sceneCount: scenes.length,
        sceneIds: scenes.map(scene => String(scene._id)),
        aspectRatio: project?.brief?.aspectRatio || scenes[0]?.aspectRatio,
        generatedAt: new Date().toISOString(),
      },
      auditable,
    });

    const assetId = (storageAsset as any)._id ? (storageAsset as any)._id.toString() : storageAsset.id;
    this.logger.log(`Storage asset ${assetId} saved for final video of project ${projectId}`);

    return {
      _id: assetId,
      id: assetId,
      type: 'video',
      storage: storageAsset.storage,
      generationMetadata: storageAsset.generationMetadata,
    };
  }

  /** `control-render` responde el error en JSON, pero como `arraybuffer` llega ilegible. */
  private describeError(error: any): string {
    const data = error?.response?.data;
    if (data) {
      try {
        const text = Buffer.isBuffer(data) || data instanceof Uint8Array ? Buffer.from(data).toString('utf8') : JSON.stringify(data);
        return text.slice(0, 1000);
      } catch {
        /* se cae al mensaje genérico */
      }
    }
    return error?.message || String(error);
  }

  private emit(projectId: string, event: string, payload: any) {
    this.eventsService.emit(projectId, { event, payload });
  }
}
