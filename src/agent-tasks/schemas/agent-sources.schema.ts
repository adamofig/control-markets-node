import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { CloudStorageData, IAgentSource, IImageSource, IVideoSource, SourceType } from '../models/classes';
import { addIdAfterSave } from '@dataclouder/nest-mongo';

export type AgentSourceDocument = AgentSourceEntity & Document;

@Schema({ collection: 'agent_sources', timestamps: true })
export class AgentSourceEntity implements IAgentSource {
  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  thumbnail: CloudStorageData;

  @Prop({ required: false })
  status: string;

  @Prop({ required: false })
  statusDescription: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  image: IImageSource;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  video: IVideoSource;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  assets?: Record<string, CloudStorageData>;

  @Prop({ required: false })
  id: string;

  @Prop({ required: false })
  description: string;

  @Prop({ required: false })
  tag: string;

  @Prop({ required: false })
  sourceUrl: string;

  @Prop({ required: false })
  img: string;

  @Prop({ required: false })
  name: string;

  @Prop({ required: false, type: String, enum: SourceType })
  type: SourceType;

  @Prop({ required: false })
  content: string;

  @Prop({ required: false })
  contentEnhancedAI: string;

  @Prop({ required: false })
  relationId: string;
}

export const AgentSourceSchema = SchemaFactory.createForClass(AgentSourceEntity);

addIdAfterSave(AgentSourceSchema);
