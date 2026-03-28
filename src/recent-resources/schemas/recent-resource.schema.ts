import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { IRecentResource, RecentResourceCollection } from '../models/recent-resources.models';

export type RecentResourceDocument = RecentResourceEntity & Document;

@Schema({ collection: 'recent_resources', timestamps: true })
export class RecentResourceEntity implements IRecentResource {
  @Prop({ required: false })
  id: string;

  @Prop({ required: true, type: String })
  userId: string;

  @Prop({ required: true, type: String })
  resourceId: string;

  @Prop({ required: true, type: String, enum: RecentResourceCollection })
  collection: RecentResourceCollection;

  @Prop({ required: true, type: String })
  name: string;

  @Prop({ required: true, type: Date, default: () => new Date() })
  accessedAt: Date;
}

export const RecentResourceSchema = SchemaFactory.createForClass(RecentResourceEntity);

addIdAfterSave(RecentResourceSchema);

RecentResourceSchema.index({ userId: 1, accessedAt: -1 });
RecentResourceSchema.index({ userId: 1, resourceId: 1 }, { unique: true });
