import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { IInspirationSource, InspirationType } from '../models/inspiration-source.models';
import { AuditDataSchema, IAuditable } from '@dataclouder/nest-core';

export type InspirationSourceDocument = InspirationSourceEntity & Document;

@Schema({ collection: 'inspiration_sources', timestamps: true })
export class InspirationSourceEntity implements IInspirationSource {
  @Prop({ required: false })
  id: string;

  @Prop({ required: false })
  orgId: string;

  @Prop({ required: false })
  title: string;

  @Prop({ required: false })
  description: string;

  @Prop({ required: false, type: String, enum: InspirationType })
  type: InspirationType;

  @Prop({ required: false, type: String, enum: ['tiktok', 'instagram', 'youtube', 'web', 'blog'] })
  platform: 'tiktok' | 'instagram' | 'youtube' | 'web' | 'blog';

  @Prop({ required: false })
  url: string;

  @Prop({ required: false })
  content: string;

  @Prop({ required: false, type: [String], default: [] })
  images: string[];

  @Prop({
    required: false,
    type: {
      isEnabled: { type: Boolean, default: false },
      frequency: { type: String, enum: ['daily', 'weekly', 'manual'], default: 'manual' },
      lastCheckAt: { type: Date },
      nextCheckAt: { type: Date },
      activeScraperId: { type: String },
    },
    default: { isEnabled: false, frequency: 'manual' },
  })
  monitoring: {
    isEnabled: boolean;
    frequency: 'daily' | 'weekly' | 'manual';
    lastCheckAt?: Date;
    nextCheckAt?: Date;
    activeScraperId?: string;
  };

  @Prop({ required: false, type: [String], default: [] })
  tags: string[];

  @Prop({ required: false, type: String, enum: ['backlog', 'monitoring', 'validated', 'archived', 'used'], default: 'backlog' })
  status: 'backlog' | 'monitoring' | 'validated' | 'archived' | 'used';

  @Prop({ required: false })
  relatedAssetId: string;

  @Prop({ type: AuditDataSchema, required: false, default: {} })
  auditable: IAuditable;

  @Prop({ required: false, type: Object })
  metadata: any;
}

export const InspirationSourceSchema = SchemaFactory.createForClass(InspirationSourceEntity);

addIdAfterSave(InspirationSourceSchema);

InspirationSourceSchema.index({ id: 1 }, { unique: true });
InspirationSourceSchema.index({ orgId: 1 });
InspirationSourceSchema.index({ type: 1 });
InspirationSourceSchema.index({ status: 1 });
