import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IVideoSource, IImageSource, IAudioSource, ISource, ILlmTask, CloudStorageData } from 'src/agent-tasks/models/classes';
import mongoose from 'mongoose';
import { IAgentCard } from '@dataclouder/nest-agent-cards';

export interface IAssets {
  audios: Record<string, IAudioSource>;
  images: Record<string, IImageSource>;
  videos: Record<string, IVideoSource>;
}

export interface IDialog {
  content: string;
  audio: CloudStorageData;
  voice: string;
  transcription: any;
  captions: any;
}

export interface ISceneAssetRef {
  generatedAssetId?: string;
  url?: string;
  status?: 'pending' | 'generating' | 'completed' | 'failed';
}

export interface IScene {
  index: number;
  dialog: {
    content: string;
    voice?: string;
    audio?: ISceneAssetRef;
    transcription?: any;
  };
  mediaType?: 'image' | 'video';
  imagePrompt?: string;
  videoPrompt?: string;
  visual?: ISceneAssetRef;
  durationSec?: number;
  transition?: string;
  visualStyle?: string;
}

/**
 * Hard relation towards `video_scenes`. Stores only the link and the position
 * (array order === playback order). Everything the UI shows is resolved at read
 * time by `hydrateVideoScenes`, so it can never go stale.
 */
export interface IVideoSceneRef {
  id: string;
  reference?: any;
}

/**
 * Read-only projection of a video scene, resolved on every single-document read
 * of a video project. Never persisted — see `toVideoSceneSummary`.
 */
export interface IVideoSceneSummary {
  id: string;
  /** true when the referenced scene no longer exists (or belongs to another org) */
  missing?: boolean;

  name?: string;
  description?: string;
  status?: string;
  durationSec?: number;
  mediaType?: string;
  aspectRatio?: string;

  thumbnailUrl?: string;
  hasImage?: boolean;
  /** Fondo de video de la escena (entrada del render), no el MP4 final. */
  hasVideo?: boolean;
  videoUrl?: string;

  /** MP4 final renderizado por `control-render` (`scene.renderStorage`). */
  hasRender?: boolean;
  renderUrl?: string;

  hasSpeech?: boolean;
  speechUrl?: string;
  speechDurationSec?: number;
  hasCaptions?: boolean;

  updatedAt?: Date | string;
}

/**
 * Resultado de propagar las referencias del proyecto (tarjeta de agente + referencias de imagen)
 * a sus escenas. `updated` cuenta sólo las escenas que realmente cambiaron en Mongo.
 */
export interface ISyncSceneReferencesResult {
  /** Escenas enlazadas al proyecto */
  total: number;
  /** Escenas alcanzadas por el update (existen y pertenecen a la org) */
  matched: number;
  /** Escenas cuyo documento cambió */
  updated: number;
  /** Id de la tarjeta propagada, o `null` si el proyecto no tiene y se quitó de las escenas */
  agentCardId: string | null;
  /** Cantidad de referencias de imagen propagadas (0 = se quitaron de las escenas) */
  imageRefs: number;
}

export interface IVideoBrief {
  concept?: string;
  targetDurationSec?: number;
  aspectRatio?: '9:16' | '16:9' | '1:1';
  sceneCount?: number;
  pace?: 'short' | 'medium' | 'long' | null;
}

/**
 * Cómo se arma el video final:
 * - `concat`: FFmpeg pega los MP4 ya renderizados de cada escena. Segundos, sin transiciones.
 * - `master`: Remotion recompone todo con transiciones y música. Minutos.
 */
export type ProjectRenderMode = 'concat' | 'master';

export interface IProjectRenderOptions {
  /** Por defecto se toma de `brief.aspectRatio`, o del de la primera escena. */
  aspectRatio?: '9:16' | '16:9' | '1:1' | '4:3' | '3:4';
  /** Sólo modo `master`: música de fondo global. */
  musicUrl?: string;
  /** 0–1. Bajo a propósito: la voz en off manda. */
  musicVolume?: number;
  /** Sólo modo `master`. `none` desactiva el solape entre escenas. */
  transitionType?: 'none' | 'fade' | 'slide' | 'wipe' | 'flip';
  transitionDurationSec?: number;
}

/** Respuesta inmediata del render final: el trabajo sigue en background, el avance va por SSE. */
export interface IProjectRenderStart {
  status: 'started';
  projectId: string;
  mode: ProjectRenderMode;
  scenes: number;
}

export interface IVideoProjectGenerator {
  id: string;
  orgId?: string;
  name?: string;
  description?: string;
  brief?: IVideoBrief;
  scenes?: IScene[];
  videoScene?: IVideoSceneRef[];
  sceneIds?: string[];
  agent?: Partial<IAgentCard>;
  agentCard?: any;
  imageRefs?: any[];
  task?: Partial<ILlmTask>;
  assets: IAssets;
  type?: string;
  sources?: Partial<ISource>[];
  compositionPlan?: { overlays: IOverlayPlan[] };
  dialogs?: IDialog[];

  /** MP4 final del proyecto (referencia suave al `storage_assets` subido a `rendered-projects/`). */
  renderStorage?: any;
  renderStatus?: 'idle' | 'rendering' | 'ready' | 'failed';
  renderMode?: ProjectRenderMode;
  renderedAt?: string;
}

export interface IFragmentExtraction {
  startSec: number | null;
  endSec: number | null;
  reason: string;
  suggestions: string;
  instructions: string;
  // Ideas for futute
  // priority?: number; // For AI ordering logic
  // tags?: string[]; // For categorization
  // transcript?: string; // Text content of the fragment
  // sentiment?: string; // Emotional tone
}
export interface IOverlayPlan {
  type: 'video';
  sourceId: string; // related to the source to get data.
  timelineStartSec: number | null;
  timelineEndSec: number | null;
  durationSec: number;
  fragment: IFragmentExtraction;
  // Idaeas for future
  // properties: any; // potencially css effects and more.
  // transitionIn?: string; // Transition effect entering this fragment
  // transitionOut?: string; // Transition effect leaving this fragment
  // zIndex?: number; // For layering elements
  // opacity?: number; // For visual effects
  // volume?: number; // For audio control
}

export class CreateVideoGeneratorDto {
  @ApiProperty({ description: 'The name of the videoGenerator item' })
  name: string;

  @ApiProperty({ description: 'The description of the videoGenerator item' })
  description: string;

  @ApiProperty({ description: 'The content of the videoGenerator item' })
  dialog: IDialog[];

  @ApiProperty({ description: 'The image of the videoGenerator item' })
  img: string;
}

export class UpdateVideoGeneratorDto extends PartialType(CreateVideoGeneratorDto) {}
