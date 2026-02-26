import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { ISocialMediaTracker } from '../models/social-media-tracker.models';
import { AuditDataSchema, IAuditable } from '@dataclouder/nest-core';
export type SocialMediaTrackerDocument = SocialMediaTrackerEntity & Document;

@Schema({ collection: 'socialMediaTracker', timestamps: true })
export class SocialMediaTrackerEntity implements ISocialMediaTracker {
  @Prop({ required: false })
  id: string;

  @Prop({ required: false })
  name: string;

  @Prop({ required: false })
  description: string;

  @Prop({ required: false, type: Object })
  asset: any;

  @Prop({ type: AuditDataSchema, required: false, default: {} })
  auditable: IAuditable;
}

export const SocialMediaTrackerSchema = SchemaFactory.createForClass(SocialMediaTrackerEntity);

addIdAfterSave(SocialMediaTrackerSchema);

SocialMediaTrackerSchema.index({ id: 1 }, { unique: true });
