import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { AuditDataSchema, IAuditable } from '@dataclouder/nest-core';
import { ISkill, ISkillFile, SkillCapabilityType, SkillFileRole, SkillKind } from '../models/skill.models';

export type SkillDocument = SkillEntity & Document;

const SKILL_KINDS: SkillKind[] = ['bundle', 'capability'];
const SKILL_FILE_ROLES: SkillFileRole[] = ['instruction', 'reference', 'script', 'example'];
const SKILL_CAPABILITY_TYPES: SkillCapabilityType[] = ['instruction_rule', 'mcp_tool', 'executable_script', 'workflow'];

/**
 * Typed (not Mixed) so Mongo rejects an unknown role at write time. The sync script is the main
 * writer here and it runs unattended; a silent typo would land a file nobody ever injects.
 */
@Schema({ _id: false })
export class SkillFileEntity implements ISkillFile {
  @Prop({ required: true })
  relPath: string;

  @Prop({ required: true, type: String, enum: SKILL_FILE_ROLES })
  role: SkillFileRole;

  @Prop({ required: true, type: Boolean, default: true })
  embedded: boolean;

  @Prop({ required: false })
  content?: string;

  @Prop({ required: false })
  contentHash?: string;
}

const SkillFileSchema = SchemaFactory.createForClass(SkillFileEntity);

@Schema({ collection: 'skills', timestamps: true })
export class SkillEntity implements ISkill {
  @Prop({ required: false })
  id: string;

  @Prop({ required: false })
  orgId: string;

  @Prop({ required: true, type: String, enum: SKILL_KINDS })
  kind: SkillKind;

  @Prop({ required: true, trim: true })
  slug: string;

  @Prop({ required: false })
  bundleId?: string;

  @Prop({ required: false })
  bundleSlug?: string;

  @Prop({ required: false })
  name: string;

  @Prop({ required: false })
  description: string;

  @Prop({ required: false, type: [String], default: [] })
  triggers?: string[];

  @Prop({ required: false, type: String, enum: SKILL_CAPABILITY_TYPES })
  type?: SkillCapabilityType;

  /** Cache of the embedded files, rewritten by `SkillsService` on every write */
  @Prop({ required: false })
  content?: string;

  @Prop({ required: false, type: [SkillFileSchema], default: [] })
  files?: SkillFileEntity[];

  @Prop({ required: false })
  workspaceId?: string;

  @Prop({ required: false })
  relPath?: string;

  @Prop({ required: false })
  contentHash?: string;

  @Prop({ required: false })
  fingerprint?: string;

  @Prop({ required: false, type: Boolean, default: true })
  enabled?: boolean;

  @Prop({ required: false })
  migratedFromSourceId?: string;

  /** Superseded source ids that still have to resolve — see ISkill.aliasIds */
  @Prop({ required: false, type: [String], default: [] })
  aliasIds?: string[];

  @Prop({ type: AuditDataSchema, required: false, default: {} })
  auditable: IAuditable;
}

export const SkillSchema = SchemaFactory.createForClass(SkillEntity);

addIdAfterSave(SkillSchema);

/**
 * The slug is the address the orchestrator resolves (`@agent-profile-specs:send-inbox`), so two rows
 * answering to the same name in one org is a correctness bug, not a nuisance. Enforced in Mongo
 * rather than in the service because the sync script writes here too.
 */
SkillSchema.index({ orgId: 1, slug: 1 }, { unique: true });
SkillSchema.index({ orgId: 1, bundleId: 1 });
SkillSchema.index({ aliasIds: 1 }, { sparse: true });
SkillSchema.index({ orgId: 1, fingerprint: 1 }, { sparse: true });
SkillSchema.index({ name: 'text', description: 'text' });
