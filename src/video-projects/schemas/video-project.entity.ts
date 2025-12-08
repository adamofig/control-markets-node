import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { IAssets, IDialog, IOverlayPlan, IVideoProjectGenerator } from '../models/video-project.models';
import * as mongoose from 'mongoose';
import { IAgentSource, IMinimalAgentSource } from 'src/agent-tasks/models/classes';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { IAgentCard } from '@dataclouder/nest-agent-cards';

export type VideoGeneratorDocument = VideoGeneratorEntity & Document;

// Define a schema for the sources subdocument
const SourceReferenceSchema = new mongoose.Schema(
  {
    id: String,
    reference: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentSourceEntity' },
    name: String,
    description: String,
    thumbnail: Object,
  },
  { _id: false }
);

const AgentCardReferenceSchema = new mongoose.Schema(
  {
    id: String,
    reference: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentCardEntity' },
    title: String,
    assets: Object,
  },
  { _id: false }
);

@Schema({ timestamps: true, collection: 'video_projects' })
export class VideoGeneratorEntity implements IVideoProjectGenerator {
  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  compositionPlan: { overlays: IOverlayPlan[] };

  @Prop({ type: [SourceReferenceSchema], required: false })
  sources: Partial<IAgentSource>[];

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  dialogs: IDialog[];

  // @Prop({ type: [AgentCardReferenceSchema], required: false })
  // agentCards: Partial<IAgentCard>[];

  @Prop({ type: AgentCardReferenceSchema, required: false })
  agent: Partial<IAgentCard>;

  @Prop({ type: String, required: false })
  type: 'video-project';

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  assets: IAssets;

  @Prop({ type: String, required: false })
  id: string;

  @Prop({ required: false })
  name: string;

  @Prop({ required: false })
  description: string;

  @Prop({ required: false })
  content: string;

  @Prop({ required: false })
  img: string;
}

export const VideoGeneratorSchema = SchemaFactory.createForClass(VideoGeneratorEntity);
VideoGeneratorSchema.plugin(addIdAfterSave);
