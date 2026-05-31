import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { IVideoScene } from '../models/video-scene.models';
import { AuditDataSchema, IAuditable } from '@dataclouder/nest-core';

export type VideoSceneDocument = VideoSceneEntity & Document;

@Schema({ collection: 'video_scenes', timestamps: true })
export class VideoSceneEntity implements IVideoScene {
  @Prop({ required: false })
  id: string;

  @Prop({ required: false })
  name: string;

  @Prop({ required: false })
  description: string;

  @Prop({ required: false, index: true })
  projectId: string;

  @Prop({ required: false, default: 0 })
  index: number;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  speechPrompt: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  speechStorage: any;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  videoPrompt: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  videoStorage: any;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  imagePrompt: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  imageStorage: any;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  imageRef: any;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  dialog: IVideoScene['dialog'];

  @Prop({ required: false })
  mediaType: string;

  @Prop({ required: false })
  aspectRatio: string;


  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  agentCard: any;

  @Prop({ required: false })
  durationSec: number;

  @Prop({ required: false })
  transition: string;

  @Prop({ required: false })
  visualStyle: string;

  @Prop({ required: false, default: 'draft' })
  status: string;



  @Prop({ type: AuditDataSchema, required: false, default: {} })
  auditable: IAuditable;
}

export const VideoSceneSchema = SchemaFactory.createForClass(VideoSceneEntity);
VideoSceneSchema.plugin(addIdAfterSave);

VideoSceneSchema.index({ id: 1 }, { unique: true });
VideoSceneSchema.index({ projectId: 1, index: 1 });
VideoSceneSchema.index({ projectId: 1, status: 1 });
VideoSceneSchema.index({ 'dialog.content': 'text', imagePrompt: 'text' });
