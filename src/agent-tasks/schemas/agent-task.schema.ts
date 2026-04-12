import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { IAgentTask, IAgentTaskSettings, AgentTaskType, AssignedType, CloudStorageData } from '../models/classes';
import { addIdAfterSave } from '@dataclouder/nest-mongo';

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
  prompt: string;

  @Prop({ required: false })
  userPrompt: string;

  @Prop({ required: false, type: Object })
  image?: CloudStorageData;

  @Prop({ required: false })
  status: string;

  @Prop({ required: false, type: String, enum: AgentTaskType })
  taskType: AgentTaskType;

  @Prop({ required: false, type: Object })
  assignedTo: any;

  @Prop({ required: false, type: String, enum: AssignedType })
  assignedType: AssignedType;

  /** All AI-specific settings nested here */
  @Prop({ required: false, type: Object })
  agentTask: IAgentTaskSettings;

  // @deprecated — kept for backward compat with existing records
  @Prop({ required: false, type: Object })
  notionOutput: { id: string; name: string; type: string };
}

export const AgentTaskSchema = SchemaFactory.createForClass(AgentTaskEntity);

addIdAfterSave(AgentTaskSchema);
