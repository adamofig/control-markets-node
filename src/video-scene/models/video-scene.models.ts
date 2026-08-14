import { IAuditable } from '@dataclouder/nest-core';
import { IStorageAsset } from '@dataclouder/nest-storage';

export interface IAnimationSettings {
  backgroundEffect: 'ken-burns' | 'pan' | 'none' | 'rapid-zoom' | 'pulse' | 'camera-shake' | 'glitch' | 'magnifying-glass';
  introEffect: 'fade';
  outroEffect: 'fade';
  introDurationSec: number;
  outroDurationSec: number;
}

export interface IImageReference {
  asset: Partial<IStorageAsset>;
  tag?: 'character' | 'style' | 'background' | string;
}

export interface IVideoScene {
  _id?: string;
  id?: string;
  orgId?: string;

  name?: string;
  description?: string;

  dialog: {
    content: string;
    voice?: string;
    audio?: any;
    transcription?: any;
  };

  speechPrompt?: string;
  speechStorage?: Partial<IStorageAsset>

  videoPrompt?: string;
  /** Video de **fondo** de la escena (generado por Veo/Comfy o elegido a mano). Es una entrada del render. */
  videoStorage?: Partial<IStorageAsset>

  /**
   * MP4 **resultante** del render final en `control-render`. Es la salida del pipeline, no una entrada:
   * nunca se usa como fondo. Vivía en `videoStorage`, lo que pisaba el fondo y hacía que un segundo
   * render se auto-incrustara (`SceneComposition.tsx` cae a `videoStorage` cuando no hay imagen).
   */
  renderStorage?: Partial<IStorageAsset>

  imagePrompt?: string;
  imageStorage?: Partial<IStorageAsset>
  /** @deprecated Use imageRefs instead */
  imageRef?: Partial<IStorageAsset>;
  imageRefs?: IImageReference[];

  mediaType?: 'image' | 'video' | string;
  aspectRatio?: string;

  durationSec?: number;
  animationSettings?: IAnimationSettings;
  visualStyle?: string;

  status?: string;

  agentCard?: any;

  auditable?: IAuditable;
}


