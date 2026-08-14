import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IAuditable } from '@dataclouder/nest-core';
import { StorageAssetCaptionsService } from '../../storage-asset/storage-asset-captions.service';
import { VideoSceneEntity } from '../schemas/video-scene.schema';
import { IScenePipelineOptions, IScenePipelineResult, IScenePipelineStep, ScenePipelineStepName } from '../models/scene-pipeline.models';
import { SceneMediaService } from './scene-media.service';
import { VideoSceneEventsService } from './video-scene-events.service';
import { VideoSceneService } from './video-scene.service';

/**
 * Corre de punta a punta lo que el usuario haría a mano en el formulario de la escena:
 * voz → captions → fondo (imagen o video) → render final.
 *
 * Dos reglas que definen su comportamiento:
 *
 * 1. **Completa, no rehace.** Cada paso se saltea si su resultado ya existe, salvo `force`. Así el
 *    botón se puede apretar varias veces sin volver a pagar la generación de lo que ya está.
 * 2. **Persiste paso a paso.** Cada resultado se guarda apenas se obtiene, no al final. Si la
 *    imagen falla, la voz que ya se generó (y se pagó) queda guardada en la escena.
 *
 * Un paso `blocked` (falta guion o prompt) no es un error: la escena simplemente no estaba lista y
 * se reporta como tal.
 */
@Injectable()
export class ScenePipelineService {
  private readonly logger = new Logger(ScenePipelineService.name);

  constructor(
    private readonly videoSceneService: VideoSceneService,
    private readonly sceneMediaService: SceneMediaService,
    private readonly captionsService: StorageAssetCaptionsService,
    private readonly eventsService: VideoSceneEventsService,
  ) {}

  async autoComplete(sceneId: string, orgId: string | undefined, auditable: IAuditable, options: IScenePipelineOptions = {}): Promise<IScenePipelineResult> {
    const { force = false, render = true } = options;

    let scene = (await this.videoSceneService.findOne(sceneId)) as VideoSceneEntity;
    if (!scene) throw new NotFoundException(`Video scene with ID ${sceneId} not found`);

    const steps: IScenePipelineStep[] = [];
    const record = (step: ScenePipelineStepName, status: IScenePipelineStep['status'], detail?: string) => {
      const entry: IScenePipelineStep = { step, status, ...(detail ? { detail } : {}) };
      steps.push(entry);
      this.eventsService.emit(sceneId, { event: 'pipeline', payload: entry });
      this.logger.log(`Scene ${sceneId} · ${step}: ${status}${detail ? ` (${detail})` : ''}`);
      return entry;
    };

    /** Guarda y refresca la escena en memoria para que el paso siguiente vea el estado nuevo. */
    const patch = async (changes: Record<string, any>) => {
      scene = (await this.videoSceneService.update(sceneId, { ...changes, auditable })) as VideoSceneEntity;
    };

    // ── 1. Voz en off ────────────────────────────────────────────────────────────────────────
    const hasSpeech = !!(scene.speechStorage as any)?.storage?.url;
    const speechText = (scene.speechPrompt || scene.dialog?.content || '').trim();
    if (hasSpeech && !force) {
      record('speech', 'skipped');
    } else if (!speechText) {
      record('speech', 'blocked', 'la escena no tiene guion (speechPrompt ni dialog.content)');
    } else {
      try {
        const asset = await this.sceneMediaService.generateSpeech(scene, orgId);
        await patch({ speechStorage: asset, ...this.durationFrom(asset.generationMetadata) });
        record('speech', 'done');
      } catch (error: any) {
        record('speech', 'failed', error.message || String(error));
      }
    }

    // ── 2. Captions sincronizados ────────────────────────────────────────────────────────────
    const speechAssetId = (scene.speechStorage as any)?.id;
    const hasCaptions = !!(scene.speechStorage as any)?.generationMetadata?.captions?.tiktokStyle?.length;
    if (!speechAssetId) {
      record('captions', 'blocked', 'sin audio del cual extraer captions');
    } else if (hasCaptions && !force) {
      record('captions', 'skipped');
    } else {
      try {
        const updatedAsset: any = await this.captionsService.extractCaptions(speechAssetId);
        await patch({
          speechStorage: { ...(scene.speechStorage as any), generationMetadata: updatedAsset.generationMetadata },
          ...this.durationFrom(updatedAsset.generationMetadata),
        });
        record('captions', 'done');
      } catch (error: any) {
        record('captions', 'failed', error.message || String(error));
      }
    }

    // ── 3. Fondo: imagen o video, según `mediaType` ──────────────────────────────────────────
    const wantsVideo = scene.mediaType === 'video';
    const backgroundStep: ScenePipelineStepName = wantsVideo ? 'video' : 'image';
    const hasBackground = wantsVideo ? !!(scene.videoStorage as any)?.storage?.url : !!(scene.imageStorage as any)?.storage?.url;
    const backgroundPrompt = (wantsVideo ? scene.videoPrompt : scene.imagePrompt)?.trim();

    if (hasBackground && !force) {
      record(backgroundStep, 'skipped');
    } else if (!backgroundPrompt) {
      record(backgroundStep, 'blocked', `la escena no tiene ${wantsVideo ? 'videoPrompt' : 'imagePrompt'}`);
    } else {
      try {
        const asset = wantsVideo
          ? await this.sceneMediaService.generateVideo(scene, orgId)
          : await this.sceneMediaService.generateImage(scene, orgId);
        await patch(wantsVideo ? { videoStorage: asset } : { imageStorage: asset });
        record(backgroundStep, 'done');
      } catch (error: any) {
        record(backgroundStep, 'failed', error.message || String(error));
      }
    }

    // ── 4. Render final ──────────────────────────────────────────────────────────────────────
    let rendered = !!(scene.renderStorage as any)?.storage?.url;
    if (!render) {
      record('render', 'skipped', 'no solicitado');
    } else {
      const readySpeech = !!(scene.speechStorage as any)?.storage?.url;
      const readyBackground = wantsVideo ? !!(scene.videoStorage as any)?.storage?.url : !!(scene.imageStorage as any)?.storage?.url;

      if (!readySpeech || !readyBackground) {
        record('render', 'blocked', `faltan insumos: ${!readySpeech ? 'voz' : ''}${!readySpeech && !readyBackground ? ' y ' : ''}${!readyBackground ? 'fondo' : ''}`);
      } else if (rendered && !force) {
        record('render', 'skipped');
      } else {
        try {
          scene = (await this.videoSceneService.renderScene(sceneId, orgId, auditable)) as VideoSceneEntity;
          rendered = true;
          record('render', 'done');
        } catch (error: any) {
          record('render', 'failed', error.message || String(error));
        }
      }
    }

    return {
      sceneId,
      name: scene?.name,
      steps,
      ok: !steps.some(step => step.status === 'failed'),
      rendered,
    };
  }

  /** La duración real del audio manda sobre la estimada: es la que define el largo del render. */
  private durationFrom(generationMetadata: any): { durationSec?: number } {
    const duration = generationMetadata?.transcription?.duration;
    return typeof duration === 'number' ? { durationSec: Math.ceil(duration) } : {};
  }
}
