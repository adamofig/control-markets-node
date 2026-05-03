import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { ISocialMediaTracker } from '../models/social-media-tracker.models';
import { AuditDataSchema, IAuditable } from '@dataclouder/nest-core';
import { StorageAssetEntity } from '@dataclouder/nest-storage';
export type SocialMediaTrackerDocument = SocialMediaTrackerEntity & Document;

@Schema({ collection: 'social_media_tracker', timestamps: true })
export class SocialMediaTrackerEntity implements ISocialMediaTracker {
  @Prop({ required: false })
  id: string;

  @Prop({ required: false })
  orgId: string;

  @Prop({ required: false })
  name: string;

  @Prop({ required: false })
  description: string;

  @Prop({ required: false, type: Types.ObjectId, ref: 'StorageAssetEntity' })
  asset: any;

  @Prop({
    required: false,
    type: Date,
    set: (v: any) => (v && typeof v === 'object' && !(v instanceof Date) ? undefined : v),
  })
  scheduledDate: Date;

  @Prop({ required: false, type: String })
  platform: string;

  @Prop({ required: false, type: [Object] })
  platforms: any[];  

  @Prop({ required: false, type: String, default: 'draft' })
  status: string;

  @Prop({ required: false, type: String })
  notes: string;

  @Prop({ required: false, type: String })
  breakdown: string;

  @Prop({ required: false, type: String })
  videoUrl: string;

  @Prop({ type: AuditDataSchema, required: false, default: {} })
  auditable: IAuditable;

}

export const SocialMediaTrackerSchema = SchemaFactory.createForClass(SocialMediaTrackerEntity);

addIdAfterSave(SocialMediaTrackerSchema);

SocialMediaTrackerSchema.index({ id: 1 }, { unique: true });
SocialMediaTrackerSchema.index({ name: 'text', description: 'text', notes: 'text' });
