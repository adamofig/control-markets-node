import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ILlmTask, AgentTaskType, ISourceTask, IAgentCardMinimal, CloudStorageData } from '../models/classes';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { IAIModel } from '@dataclouder/nest-vertex';

export type AgentTaskDocument = AgentTaskEntity & Document;

// TODO: Change the table name to llm_tasks in future.
@Schema({ collection: 'agent_tasks', timestamps: true })
export class AgentTaskEntity implements ILlmTask {
  _id?: string;

  @Prop({ required: false })
  id: string;

  @Prop({ required: false })
  name: string;

  @Prop({ required: false })
  description: string;

  @Prop({ required: false })
  prompt: string;

  @Prop({ required: false })
  userPrompt: string;

  @Prop({ required: false, type: Object })
  model: IAIModel;

  @Prop({ required: false, type: Object })
  output: { id: string; name: string; type: string };

  @Prop({ required: false, type: String, enum: ['json', 'default'] })
  outputFormat: 'json' | 'default';

  @Prop({ required: false, type: Object })
  notionOutput: { id: string; name: string; type: string };

  @Prop({ required: false, type: Object })
  image?: CloudStorageData;

  @Prop({ required: false, type: Object })
  agentCard: IAgentCardMinimal;

  @Prop({ required: false, type: [Object] })
  agentCards: IAgentCardMinimal[];

  @Prop({ required: false })
  sources: ISourceTask[];

  @Prop({ required: false })
  status: string;

  @Prop({ required: false, type: String, enum: AgentTaskType })
  taskType: AgentTaskType;

  @Prop({ required: false, type: Object })
  taskAttached: Partial<ILlmTask>;
}

export const AgentTaskSchema = SchemaFactory.createForClass(AgentTaskEntity);

addIdAfterSave(AgentTaskSchema);
