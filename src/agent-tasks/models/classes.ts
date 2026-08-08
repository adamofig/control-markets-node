import { IAgentCard } from '@dataclouder/nest-agent-cards';
import { IAIModel } from '@dataclouder/nest-ai-services-sdk';
import { IAuditable } from '@dataclouder/nest-core';
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
  TEXT_RESPONSE = 'text_response',
  HUMAN_TASK = 'human_task',
}

export interface ISourceTask {
  id: string;
  name: string;
  type: string;
}

export type IAgentCardMinimal = Pick<IAgentCard, 'id' | 'assets' | 'description' | 'name'>;

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  /** Work finished by the assignee, waiting for a reviewer (human or agent) to approve it. */
  IN_REVIEW = 'in_review',
  DONE = 'done',
  PAUSED = 'paused',
  NOT_DEFINED = '',
  NA = null,
}

/** Statuses accepted by the markdown sync and the MCP tools (excludes the empty/null legacy values). */
export const TASK_STATUS_VALUES = ['pending', 'in_progress', 'in_review', 'done', 'paused'] as const;

/**
 * Canonical status ↔ markdown checkbox mark. Single source of truth for the wiki sync:
 * the CLI parser reads these marks and the write-back writes them back.
 * `[ ]` pending · `[/]` in_progress · `[r]` in_review · `[x]` done · `[-]` paused.
 */
export const TASK_STATUS_MARKS: Record<string, string> = {
  pending: ' ',
  in_progress: '/',
  in_review: 'r',
  done: 'x',
  paused: '-',
};

export const MARK_TO_TASK_STATUS: Record<string, string> = {
  '': 'pending',
  ' ': 'pending',
  '/': 'in_progress',
  r: 'in_review',
  x: 'done',
  '-': 'paused',
};

/**
 * Urgency scale 1..5. Higher is more urgent — always sort descending.
 * The scale is fixed by product: 1 Baja, 2 Media (default), 3 Alta, 4 Importante, 5 Crítica.
 */
export type TaskPriority = 1 | 2 | 3 | 4 | 5;

export const DEFAULT_TASK_PRIORITY: TaskPriority = 2;

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  1: 'Baja',
  2: 'Media',
  3: 'Alta',
  4: 'Importante',
  5: 'Crítica',
};

/** Coerces "4", 4 or 4.0 to a valid TaskPriority. Returns undefined for anything out of range. */
export function normalizeTaskPriority(value: unknown): TaskPriority | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : parseInt(String(value).trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > 5) return undefined;
  return n as TaskPriority;
}

export enum AssignedType {
  AGENT = 'agent',
  USER = 'user',
}

export interface IAssignedUser {
  userId: string;
  email: string;
  name: string;
}

export type IAssignedTo = IAssignedUser | IAgentCardMinimal;

export enum SubtaskStatus {
  PENDING = 'pending',
  DONE = 'done',
}

/** Checklist item inside a task. Order is the array order. */
export interface ISubtask {
  id: string;
  name: string;
  description?: string;
  status: SubtaskStatus;
  completedAt?: Date | string;
  /** Email of the user or name of the agent that completed it */
  completedBy?: string;
}

export interface ITask {
  _id?: string;
  id?: string;
  orgId?: string;

  name: string;
  description?: string;
  content?: string;
  sourceUrl?: string;

  assignedTo?: IAssignedTo;
  assignedType?: AssignedType;
  status?: TaskStatus;
  /** 1..5, higher is more urgent. Defaults to 2 (Media) on creation. */
  priority?: TaskPriority;
  image?: CloudStorageData;
  taskType?: AgentTaskType | string;
  subtasks?: ISubtask[];

  auditable?: IAuditable;
}

export interface IAgentTaskSettings {
  agentCard?: IAgentCardMinimal;
  agentCards?: IAgentCardMinimal[];
  sources?: ISourceTask[];
  model?: IAIModel;
  output?: ILlmTaskOutput;
  outputFormat?: 'json' | 'default';
  taskAttached?: Partial<IAgentTask>;
}

/**
 * Minimal reference to the agentic profile that owns the task — the canonical assignment field.
 * The card travels here only as `agentCardId`, so consumers resolve identity/voice without a
 * second lookup. Mirrors `IAgenticProfileMinimal` in the Angular models.
 */
export interface IAgentProfileMinimal {
  id: string;
  name?: string;
  title?: string;
  /** The profile's linked card (`AgenticProfile.agentCard.id`). */
  agentCardId?: string;
  imageUrl?: string;
}

export interface IAgentTask extends ITask {
  prompt?: string;
  userPrompt?: string;
  agentTask?: IAgentTaskSettings;
  /** Derived from the profile on save. Kept because execution, jobs and list views read it. */
  agentCard?: IAgentCardMinimal;
  /** Flat indexed mirror of `agenticProfile.id`, maintained by the backend. */
  agenticProfileId?: string;
  /** Canonical field: the agentic profile responsible for the task. */
  agenticProfile?: IAgentProfileMinimal;
}

/** @deprecated Use IAgentTask instead */
export type ILlmTask = IAgentTask;

/**
 * Projection of the fields other entities denormalize from a task (today: the agentic profile's
 * `tasks[]` refs). `orgId` travels with it so the consumer can reject a cross-tenant match.
 */
export interface ITaskRefFields {
  id?: string;
  _id?: any;
  orgId?: string;
  name?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  updatedAt?: Date | string;
}

// Tiene una relación con el agente y la tarea. parcial asi muestro graficamente que pasa.
export interface IAgentOutcomeJob {
  _id?: string;
  id?: string;
  task: Partial<IAgentTask>; // Relation with the task
  agentCard?: Partial<IAgentCardMinimal>; // Relation with the agent card
  agenticProfile?: Partial<IAgentProfileMinimal>; // Relation with the assigned agentic profile
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

export interface ISource {
  id: string;
  orgId?: string;
  auditable?: IAuditable;
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

export interface IMinimalSource {
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
