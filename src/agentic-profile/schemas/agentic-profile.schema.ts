import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { AuditDataSchema, IAuditable } from '@dataclouder/nest-core';
import { AgenticContextLevel, IAgentCardRef, IAgenticProfile, IAgenticProfileSource, IAgenticProfileSkill, IAgenticProfileTaskRef, IAgenticProfileMemory, IAgenticProfileExploration, IAgenticHeartbeat } from '../models/agentic-profile.models';

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

  /** Workspace (project) slug this profile belongs to — sets the ACP cwd and the sync fingerprint scope */
  @Prop({ required: false })
  workspaceId?: string;

  /** Path of the profile markdown file relative to the workspace root — anchor for local write-backs */
  @Prop({ required: false })
  relPath?: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  heartbeat?: IAgenticHeartbeat;

  @Prop({ type: String, enum: ['basic', 'medium', 'full'], default: 'basic' })
  contextLevel?: AgenticContextLevel;

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
