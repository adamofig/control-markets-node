import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { IAgentTask, IAgentTaskSettings, AgentTaskType, AssignedType, IAssignedTo, CloudStorageData, TaskStatus, IAgentCardMinimal, ISubtask } from '../models/classes';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { AuditDataSchema, IAuditable } from '@dataclouder/nest-core';

export type AgentTaskDocument = AgentTaskEntity & Document;

@Schema({ collection: 'agent_tasks', timestamps: true })
export class AgentTaskEntity implements IAgentTask {
  _id?: string;

  @Prop({ required: false })
  id: string;

  @Prop({ required: false })
  orgId: string;

  @Prop({ required: false })
  name: string;

  @Prop({ required: false })
  description: string;

  @Prop({ required: false })
  content: string;

  /** Local markdown source path (file://) when the task is synced from an agent spec */
  @Prop({ required: false })
  sourceUrl: string;

  @Prop({ required: false })
  prompt: string;

  @Prop({ required: false })
  userPrompt: string;

  @Prop({ required: false, type: Object })
  image?: CloudStorageData;

  @Prop({ required: false, type: String, enum: Object.values(TaskStatus) })
  status: TaskStatus;

  @Prop({ required: false, type: String })
  taskType: AgentTaskType | string;

  @Prop({ required: false, type: Object })
  assignedTo: IAssignedTo;

  @Prop({ required: false, type: String, enum: AssignedType })
  assignedType: AssignedType;

  /** Checklist of subtasks; parent auto-completes when all are done */
  @Prop({ required: false, type: Array, default: undefined })
  subtasks?: ISubtask[];

  /** All AI-specific settings nested here */
  @Prop({ required: false, type: Object })
  agentTask: IAgentTaskSettings;

  @Prop({ required: false, type: Object })
  agentCard: IAgentCardMinimal;

  // @deprecated — kept for backward compat with existing records
  @Prop({ required: false, type: Object })
  notionOutput: { id: string; name: string; type: string };

  @Prop({ type: AuditDataSchema, required: false, default: {} })
  auditable: IAuditable;

  /** sha256 of the normalized markdown content — state key of the universal sync contract */
  @Prop({ required: false })
  contentHash?: string;

  /** sha256(workspaceId + ':' + relPath) — location-identity key of the sync contract */
  @Prop({ required: false })
  fingerprint?: string;

  /** Workspace (project) slug this task belongs to, e.g. 'control-markets' */
  @Prop({ required: false })
  workspaceId?: string;

  /** Path relative to the workspace root (posix separators) */
  @Prop({ required: false })
  relPath?: string;
}

export const AgentTaskSchema = SchemaFactory.createForClass(AgentTaskEntity);

addIdAfterSave(AgentTaskSchema);

AgentTaskSchema.index({ name: 'text', description: 'text' });
AgentTaskSchema.index({ orgId: 1, fingerprint: 1 }, { sparse: true });
