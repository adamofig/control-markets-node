import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { IFlowExecutionState, StatusJob } from '../models/creative-flowboard.models';

export type FlowExecutionStateDocument = FlowExecutionStateEntity & Document;

@Schema({ collection: 'flow_execution_states', timestamps: true })
export class FlowExecutionStateEntity implements IFlowExecutionState {
  _id?: string;

  @Prop()
  id: string;

  @Prop({ required: true })
  flowExecutionId: string;

  @Prop({ required: true })
  flowId: string;

  @Prop({ type: String, required: true, enum: Object.values(StatusJob) })
  status: StatusJob;

  @Prop({ type: [Object], required: true })
  tasks: any[];
}

export const FlowExecutionStateSchema = SchemaFactory.createForClass(FlowExecutionStateEntity);

addIdAfterSave(FlowExecutionStateSchema);

FlowExecutionStateSchema.index({ id: 1 });
FlowExecutionStateSchema.index({ executionId: 1 });
