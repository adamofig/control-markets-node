import { IAuditable } from '@dataclouder/nest-core';
import { IStorageAsset } from '@dataclouder/nest-storage';

export interface IVideoScene {
  _id?: string;
  id?: string;
  orgId?: string;

  name?: string;
  description?: string;

  projectId: string;
  index: number;

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
  imageRef?: Partial<IStorageAsset>;

  mediaType?: 'image' | 'video' | string;
  aspectRatio?: string;

  durationSec?: number;
  transition?: string;
  visualStyle?: string;

  status?: string;

  agentCard?: any;

  auditable?: IAuditable;
}


