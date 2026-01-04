import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { ICreativeFlowBoard, IFlowEdge, IFlowNode } from '../models/agent-flows.models';
export type AgentFlowsDocument = AgentFlowsEntity & Document;

@Schema({ collection: 'agent_flows', timestamps: true })
export class AgentFlowsEntity implements ICreativeFlowBoard {
  _id?: string;

  @Prop()
  id: string;

  @Prop()
  orgId: string;

  @Prop({ required: false })
  name: string;

  @Prop({ type: [Object], required: false })
  nodes: IFlowNode[];

  @Prop({ type: [Object], required: false })
  edges: IFlowEdge[];

  @Prop({ type: Object, required: false })
  metadata: any;
}

export const AgentFlowsSchema = SchemaFactory.createForClass(AgentFlowsEntity);

addIdAfterSave(AgentFlowsSchema);

AgentFlowsSchema.index({ id: 1 });
