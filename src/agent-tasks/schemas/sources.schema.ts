import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { CloudStorageData, ISource, IImageSource, IVideoSource, SourceType } from '../models/classes';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { AuditDataSchema } from '@dataclouder/nest-core';

export type SourceDocument = SourceEntity & Document;

@Schema({ collection: 'sources', timestamps: true })
export class SourceEntity implements ISource {
  @Prop({ required: false })
  orgId?: string;

  @Prop({ type: AuditDataSchema, required: false })
  auditable?: any;

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

  /** sha256 of the normalized markdown content — state key of the universal sync contract */
  @Prop({ required: false })
  contentHash?: string;

  /** sha256(workspaceId + ':' + relPath) — location-identity key of the sync contract */
  @Prop({ required: false })
  fingerprint?: string;

  /** Workspace (project) slug this source belongs to, e.g. 'control-markets' */
  @Prop({ required: false })
  workspaceId?: string;

  /** Path relative to the workspace root (posix separators) */
  @Prop({ required: false })
  relPath?: string;

  /** Sync contract kind: knowledge | skill | exploration | memory */
  @Prop({ required: false })
  kind?: string;
}

export const SourceSchema = SchemaFactory.createForClass(SourceEntity);

addIdAfterSave(SourceSchema);

SourceSchema.index({ name: 'text', description: 'text' });
SourceSchema.index({ orgId: 1, fingerprint: 1 }, { sparse: true });
