import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ILlmTask, AgentTaskType, ISourceTask, IAgentOutcomeJob } from '../models/classes';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { IAgentCard } from '@dataclouder/nest-agent-cards';

export type AgentJobDocument = AgentJobEntity & Document;

@Schema({ collection: 'agent_outcome_jobs', timestamps: true })
export class AgentJobEntity implements IAgentOutcomeJob {
  _id?: string;

  @Prop({ required: false })
  id: string;
  @Prop({ required: false, type: Object })
  task: Partial<ILlmTask>;

  @Prop({ required: false })
  responseFormat?: string;
  @Prop({ required: false })
  infoFromSources: string;

  @Prop({ required: false, type: Object })
  agentCard: Partial<IAgentCard>;

  @Prop({ required: false })
  messages: any[];

  @Prop({ type: Object, required: false })
  response: any;

  @Prop({ type: Object, required: false })
  result: any;

  @Prop({ required: false })
  sources: ISourceTask[];

  @Prop({ required: false })
  inputNodeId: string;
}

export const AgentJobSchema = SchemaFactory.createForClass(AgentJobEntity);

addIdAfterSave(AgentJobSchema);
