import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { AuditDataSchema, IAuditable } from '@dataclouder/nest-core';
import { HRContractType, HRStatus, IHumanResource, IPaymentConfig } from '../models/human-resource.models';

export type HumanResourceDocument = HumanResourceEntity & Document;

@Schema({ collection: 'human_resources', timestamps: true })
export class HumanResourceEntity implements IHumanResource {
  @Prop({ required: false })
  id: string;

  @Prop({ required: false })
  orgId: string;

  @Prop({ required: false })
  userId: string;

  @Prop({ required: false })
  name: string;

  @Prop({ required: false })
  role: string;

  @Prop({ required: false })
  description: string;

  @Prop({ type: String, required: false, enum: HRStatus, default: HRStatus.ACTIVE })
  status: HRStatus;

  @Prop({ type: String, required: false, enum: HRContractType })
  contractType: HRContractType;

  @Prop({ type: [String], required: false, default: [] })
  skills: string[];

  @Prop({ type: Object, required: false })
  payment: IPaymentConfig;

  @Prop({ required: false })
  startDate: Date;

  @Prop({ required: false })
  endDate: Date;

  @Prop({ type: AuditDataSchema, required: false, default: {} })
  auditable: IAuditable;
}

export const HumanResourceSchema = SchemaFactory.createForClass(HumanResourceEntity);

addIdAfterSave(HumanResourceSchema);

HumanResourceSchema.index({ id: 1 }, { unique: true });
HumanResourceSchema.index({ orgId: 1 });
HumanResourceSchema.index({ userId: 1 });
