import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { IAgentTask, IAgentTaskSettings, AgentTaskType, AssignedType, IAssignedTo, CloudStorageData, TaskStatus } from '../models/classes';
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

  /** All AI-specific settings nested here */
  @Prop({ required: false, type: Object })
  agentTask: IAgentTaskSettings;

  // @deprecated — kept for backward compat with existing records
  @Prop({ required: false, type: Object })
  notionOutput: { id: string; name: string; type: string };

  @Prop({ type: AuditDataSchema, required: false, default: {} })
  auditable: IAuditable;
}

export const AgentTaskSchema = SchemaFactory.createForClass(AgentTaskEntity);

addIdAfterSave(AgentTaskSchema);

AgentTaskSchema.index({ name: 'text', description: 'text' });
