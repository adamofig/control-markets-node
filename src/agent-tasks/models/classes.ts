import { IAgentCard } from '@dataclouder/nest-agent-cards';
import { IAIModel } from '@dataclouder/nest-ai-services-sdk';
import { ObjectId } from 'mongoose';

export interface CloudStorageData {
  bucket?: string;
  url?: string;
  path?: string; // path where the file is in the storage
}

export interface MessageAI {
  role: string;
  content: string;
}

export enum AgentTaskType {
  REVIEW_TASK = 'review_task',
  CREATE_CONTENT = 'create_content',
}

export interface ISourceTask {
  id: string;
  name: string;
  type: string;
}

export type IAgentCardMinimal = Pick<IAgentCard, 'id' | 'assets' | 'title'> & { name: string };

export interface ILlmTask {
  _id?: string;
  id: string;

  agentCard: IAgentCardMinimal;
  agentCards: IAgentCardMinimal[];
  name: string;
  description: string;
  status: string;
  prompt: string;
  taskType: AgentTaskType;
  sources: ISourceTask[];
  model: IAIModel;
  output: ILlmTaskOutput;
  outputFormat: 'json' | 'default';
  taskAttached: Partial<ILlmTask>;
  image?: CloudStorageData;
}

// Tiene una relación con el agente y la tarea. parcial asi muestro graficamente que pasa.
export interface IAgentOutcomeJob {
  _id?: string;
  id?: string;
  task: Partial<ILlmTask>; // Relation with the task
  agentCard?: Partial<IAgentCardMinimal>; // Relation with the agent card
  messages: MessageAI[]; // OpenAI format for Messages Request
  response?: MessageAI; // OpenAI format for Response of the AI
  result?: any; // This is the Object result from the AI
  responseFormat?: string; // Format of the response
  sources?: ISourceTask[]; // Relation with sources.
  infoFromSources?: string; // Consolidated information from sources
  inputNodeId?: string; // This is special for canvas feature.
}

export enum SourceType {
  DOCUMENT = 'document',
  WEBSITE = 'website',
  YOUTUBE = 'youtube',
  NOTION = 'notion',
  TIKTOK = 'tiktok',
}

export interface IAgentSource {
  id: string;
  name: string;
  description: string; // Summary of the source
  content: string; // Content of the source
  contentEnhancedAI?: string; // Content enhanced by AI
  type: SourceType;
  sourceUrl: string;
  image: IImageSource;
  video: IVideoSource;
  assets?: Record<string, CloudStorageData>;
  thumbnail: CloudStorageData; // Not Sure of this will tryig
  status: string;
  statusDescription: string;
  relationId: string; // if the source contains more data in another table?
  tag: string; // What ever tag you want to add usally rule, or context.
}

export interface IMinimalAgentSource {
  id: ObjectId;
  name: string;
  description: string;
}

export interface IImageSource {
  image: CloudStorageData;
  description: string;
  title: string;
}

export interface IAudioSource {
  audio: CloudStorageData;
  transcription: string;
  description: string;
}

export interface IVideoSource {
  id_platform: string;
  audio: CloudStorageData;
  separatedAudio?: { vocals?: CloudStorageData; accompaniment?: CloudStorageData };
  video: CloudStorageData;
  frames: IImageSource[];
  videoPreview: CloudStorageData; // Preview of the video can be a frame or user custom thumbnail
  transcription: any; // Check the type for whisper transcription
  description: string;
}

export interface ILlmTaskOutput {
  id: string;
  name: string;
  type: string;
}

export enum OutputTaks {
  NOTION_PAGE = 'notion_page',
}
