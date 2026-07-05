import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { AuditDataSchema, IAuditable } from '@dataclouder/nest-core';
import { IAgentCardRef, IAgenticProfile, IAgenticProfileSource, IAgenticProfileSkill, IAgenticProfileTaskRef, IAgenticProfileMemory, IAgenticProfileExploration, IAgenticHeartbeat } from '../models/agentic-profile.models';

export type AgenticProfileDocument = AgenticProfileEntity & Document;

@Schema({ collection: 'agentic_profiles', timestamps: true })
export class AgenticProfileEntity implements IAgenticProfile {
  @Prop({ required: false })
  id: string;

  @Prop({ required: false })
  orgId: string;

  @Prop({ required: false })
  name: string;

  @Prop({ required: false })
  title: string;

  @Prop({ required: false })
  description: string;

  @Prop({ required: false })
  domain: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  agentCard?: IAgentCardRef;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false, default: [] })
  sources?: IAgenticProfileSource[];

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false, default: [] })
  skills?: IAgenticProfileSkill[];

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false, default: [] })
  tasks?: IAgenticProfileTaskRef[];

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false, default: [] })
  memories?: IAgenticProfileMemory[];

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false, default: [] })
  explorations?: IAgenticProfileExploration[];

  @Prop({ required: false })
  liveBriefing?: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  heartbeat?: IAgenticHeartbeat;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false, default: {} })
  metadata?: Record<string, any>;

  @Prop({ type: AuditDataSchema, required: false, default: {} })
  auditable: IAuditable;
}

export const AgenticProfileSchema = SchemaFactory.createForClass(AgenticProfileEntity);

addIdAfterSave(AgenticProfileSchema);

AgenticProfileSchema.index({ id: 1 }, { unique: true });
AgenticProfileSchema.index({ orgId: 1 });
AgenticProfileSchema.index({ 'agentCard.id': 1 });
AgenticProfileSchema.index({ name: 'text', description: 'text', title: 'text', domain: 'text' });
