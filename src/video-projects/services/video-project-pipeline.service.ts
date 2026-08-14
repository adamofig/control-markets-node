import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IAuditable } from '@dataclouder/nest-core';
import { ScenePipelineService } from '../../video-scene/services/scene-pipeline.service';
import { IScenePipelineOptions, IScenePipelineResult } from '../../video-scene/models/scene-pipeline.models';
import { VideoGeneratorService } from './video-project-generator.service';
import { VideoProjectEventsService } from './video-project-events.service';

export interface IProjectPipelineStart {
  status: 'started';
  projectId: string;
  scenes: number;
}

/**
 * Genera la media faltante de **todas** las escenas de un proyecto y las renderiza, en un solo
 * disparo desde la vista del proyecto.
 *
 * Corre en background a propósito: cuatro escenas con voz + imagen + render son varios minutos, muy
 * por encima de lo que aguanta un request HTTP detrás de un proxy. El endpoint responde `202` con
 * el conteo de escenas y el avance viaja por SSE (`/api/video-generator/subscribe/:id`).
 *
 * Las escenas se procesan **en serie**, no en paralelo: cada una pega contra `ai-services` y contra
 * `control-render`, y lanzarlas todas juntas satura el render (Remotion + FFmpeg) sin terminar antes.
 */
@Injectable()
export class VideoProjectPipelineService {
  private readonly logger = new Logger(VideoProjectPipelineService.name);
  /** Un proyecto a la vez: evita que dos clicks dupliquen generaciones (y su costo). */
  private readonly running = new Set<string>();

  constructor(
    private readonly videoGeneratorService: VideoGeneratorService,
    private readonly scenePipelineService: ScenePipelineService,
    private readonly eventsService: VideoProjectEventsService,
  ) {}

  isRunning(projectId: string): boolean {
    return this.running.has(projectId);
  }

  /**
   * Valida el proyecto, marca la corrida como activa y lanza el trabajo sin esperarlo.
   * Devuelve apenas sabe cuántas escenas va a procesar.
   */
  async startGenerateAll(
    projectId: string,
    orgId: string | undefined,
    auditable: IAuditable,
    options: IScenePipelineOptions = {},
  ): Promise<IProjectPipelineStart> {
    if (this.running.has(projectId)) {
      throw new ConflictException('Este proyecto ya tiene una generación en curso');
    }

    const project = await this.videoGeneratorService.findOne(projectId);
    if (!project) throw new NotFoundException(`Video project with ID ${projectId} not found`);

    const sceneIds: string[] = ((project as any).videoScene || []).map((ref: any) => ref?.id).filter(Boolean);
    if (sceneIds.length === 0) {
      throw new NotFoundException('El proyecto no tiene escenas vinculadas');
    }

    this.running.add(projectId);
    // Sin `await`: el request contesta ya y el trabajo sigue en el proceso.
    void this.run(projectId, sceneIds, orgId, auditable, options);

    return { status: 'started', projectId, scenes: sceneIds.length };
  }

  private async run(
    projectId: string,
    sceneIds: string[],
    orgId: string | undefined,
    auditable: IAuditable,
    options: IScenePipelineOptions,
  ): Promise<void> {
    const total = sceneIds.length;
    const results: IScenePipelineResult[] = [];
    this.emit(projectId, 'start', { total, options });

    try {
      for (const [index, sceneId] of sceneIds.entries()) {
        this.emit(projectId, 'scene-start', { sceneId, index, total });
        try {
          const result = await this.scenePipelineService.autoComplete(sceneId, orgId, auditable, options);
          results.push(result);
          this.emit(projectId, 'scene-complete', { ...result, index, total });
        } catch (error: any) {
          // Una escena rota no cancela el resto: el usuario prefiere 3 de 4 antes que 0 de 4.
          this.logger.error(`Scene ${sceneId} failed inside project ${projectId}: ${error.message || error}`);
          const failed: IScenePipelineResult = {
            sceneId,
            steps: [{ step: 'speech', status: 'failed', detail: error.message || String(error) }],
            ok: false,
            rendered: false,
          };
          results.push(failed);
          this.emit(projectId, 'scene-failed', { ...failed, index, total });
        }
      }

      this.emit(projectId, 'complete', {
        total,
        rendered: results.filter(r => r.rendered).length,
        failed: results.filter(r => !r.ok).length,
        results,
      });
    } finally {
      this.running.delete(projectId);
    }
  }

  private emit(projectId: string, event: string, payload: any) {
    this.eventsService.emit(projectId, { event, payload });
  }
}
