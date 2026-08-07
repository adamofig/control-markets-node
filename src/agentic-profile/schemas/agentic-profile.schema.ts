import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { AuditDataSchema, IAuditable } from '@dataclouder/nest-core';
import {
  AgenticContextLevel,
  IAgentCardRef,
  IAgenticHeartbeat,
  IAgenticProfile,
  IAgenticProfileDelegation,
  IAgenticProfileExploration,
  IAgenticProfileMemory,
  IAgenticProfileSource,
  IAgenticProfileSkill,
  IAgenticProfileTaskRef,
  IAgenticProfileAcpConfig,
} from '../models/agentic-profile.models';
import { ACP_ENGINES, AcpEngine, CodexReasoningEffort, REASONING_EFFORTS } from '../../common/acp-engines';

export type AgenticProfileDocument = AgenticProfileEntity & Document;

@Schema({ _id: false })
export class AgenticProfilePatDelegationEntity {
  @Prop({ type: Boolean, required: true, default: false })
  enabled: boolean;

  @Prop({ type: [String], required: true, default: [] })
  allowedUserIds: string[];
}

const AgenticProfilePatDelegationSchema = SchemaFactory.createForClass(AgenticProfilePatDelegationEntity);

@Schema({ _id: false })
export class AgenticProfileDelegationEntity implements IAgenticProfileDelegation {
  @Prop({ type: AgenticProfilePatDelegationSchema, required: true, default: () => ({ enabled: false, allowedUserIds: [] }) })
  pat: AgenticProfilePatDelegationEntity;
}

const AgenticProfileDelegationSchema = SchemaFactory.createForClass(AgenticProfileDelegationEntity);

/**
 * Default engine/model for this profile. Typed (not Mixed) so Mongo rejects a retired engine id or a
 * bogus effort at write time — the chat and the heartbeat both read this as their fallback, so a
 * silent typo here would degrade every execution instead of failing loudly.
 */
@Schema({ _id: false })
export class AgenticProfileAcpConfigEntity implements IAgenticProfileAcpConfig {
  @Prop({ type: String, enum: ACP_ENGINES, required: false })
  defaultEngine?: AcpEngine;

  @Prop({ type: String, required: false, trim: true, maxlength: 128 })
  defaultModel?: string;

  @Prop({ type: String, enum: REASONING_EFFORTS, required: false })
  reasoningEffort?: CodexReasoningEffort;
}

const AgenticProfileAcpConfigSchema = SchemaFactory.createForClass(AgenticProfileAcpConfigEntity);

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

  /** No default: an absent acpConfig must fall through to today's behaviour, not pin an engine. */
  @Prop({ type: AgenticProfileAcpConfigSchema, required: false })
  acpConfig?: IAgenticProfileAcpConfig;

  @Prop({ type: String, enum: ['basic', 'medium', 'full'], default: 'basic' })
  contextLevel?: AgenticContextLevel;

  @Prop({ type: AgenticProfileDelegationSchema, required: false, default: () => ({ pat: { enabled: false, allowedUserIds: [] } }) })
  delegation?: IAgenticProfileDelegation;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false, default: {} })
  metadata?: Record<string, any>;

  @Prop({ type: AuditDataSchema, required: false, default: {} })
  auditable: IAuditable;
}

export const AgenticProfileSchema = SchemaFactory.createForClass(AgenticProfileEntity);

addIdAfterSave(AgenticProfileSchema);

AgenticProfileSchema.index({ id: 1 }, { unique: true });
AgenticProfileSchema.index({ orgId: 1 });
AgenticProfileSchema.index(
  { orgId: 1, 'agentCard.id': 1 },
  {
    unique: true,
    partialFilterExpression: {
      orgId: { $type: 'string' },
      'agentCard.id': { $type: 'string' },
    },
  }
);
AgenticProfileSchema.index({ name: 'text', description: 'text', title: 'text', domain: 'text' });
