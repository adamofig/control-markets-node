import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { ILead, PhoneNumberData } from '../models/lead.models';
import { AuditDataSchema, IAssetable, IAuditable } from '@dataclouder/nest-core';
import { ChatMessage } from '@dataclouder/nest-agent-cards';
export type LeadDocument = LeadEntity & Document;

@Schema({ collection: 'lead', timestamps: true })
export class LeadEntity implements ILead {
  @Prop({ required: false })
  id: string;

  @Prop({ required: false })
  name: string;

  @Prop({ required: false })
  description: string;

  @Prop({ required: false })
  fullName: string;

  @Prop({ required: false })
  phoneNumber: string;

  @Prop({ type: Object, required: false })
  phoneNumberData: PhoneNumberData;

  @Prop({ type: Object, required: false })
  assets: IAssetable;

  @Prop({ type: AuditDataSchema, required: false, default: {} })
  auditable: IAuditable;

  @Prop({ type: [Object], required: false })
  messages: ChatMessage[];

  @Prop({ type: Object, required: false })
  conversationAnalysis: any;
}

export const LeadSchema = SchemaFactory.createForClass(LeadEntity);

addIdAfterSave(LeadSchema);

LeadSchema.index({ id: 1 }, { unique: true });
