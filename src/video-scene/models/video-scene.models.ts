import { IAuditable } from '@dataclouder/nest-core';
import { IStorageAsset } from '@dataclouder/nest-storage';

export interface IAnimationSettings {
  backgroundEffect: 'ken-burns' | 'pan' | 'none' | 'rapid-zoom' | 'pulse' | 'camera-shake' | 'glitch';
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
  videoStorage?: Partial<IStorageAsset>

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


