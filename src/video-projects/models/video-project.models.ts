import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IVideoSource, IImageSource, IAudioSource, IAgentSource, ILlmTask, CloudStorageData } from 'src/agent-tasks/models/classes';
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
  transcription: any; // TODO: Define transcription type whisper
  captions: any; // TODO: Define captions type whisper
}
export interface IVideoProjectGenerator {
  id: string;
  name?: string;
  description?: string;
  agent?: Partial<IAgentCard>;
  task?: Partial<ILlmTask>;
  assets: IAssets;
  type?: string;
  sources?: Partial<IAgentSource>[];
  compositionPlan?: { overlays: IOverlayPlan[] };
  dialogs?: IDialog[];
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
