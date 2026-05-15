import { IAuditable } from '@dataclouder/nest-core';

export interface IVideoScene {
  _id?: string;
  id?: string;

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

  mediaType?: 'image' | 'video' | string;
  imagePrompt?: string;
  videoPrompt?: string;

  durationSec?: number;
  transition?: string;
  visualStyle?: string;

  status?: string;

  speechStorage?: any;
  videoStorage?: any;
  imageStorage?: any;

  agentCard?: any;

  auditable?: IAuditable;
}


