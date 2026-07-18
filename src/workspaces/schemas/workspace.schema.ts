import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { IWorkspace } from '../models/workspace.models';
import { AuditDataSchema, IAuditable } from '@dataclouder/nest-core';

export type WorkspaceDocument = WorkspaceEntity & Document;

@Schema({ collection: 'workspaces', timestamps: true })
export class WorkspaceEntity implements IWorkspace {
  @Prop({ required: false })
  id: string;

  @Prop({ required: false })
  orgId: string;

  /** Stable identifier used inside sync fingerprints — never rename lightly */
  @Prop({ required: false })
  slug: string;

  @Prop({ required: false })
  name: string;

  @Prop({ required: false })
  description: string;

  /** Where the wiki lives inside the workspace root, e.g. 'control-markets-wiki' */
  @Prop({ required: false })
  wikiSubdir: string;

  /** Agents directory inside the wiki, defaults to '12-agents' */
  @Prop({ required: false, default: '12-agents' })
  agentsDir: string;

  @Prop({ type: AuditDataSchema, required: false, default: {} })
  auditable: IAuditable;
}

export const WorkspaceSchema = SchemaFactory.createForClass(WorkspaceEntity);

addIdAfterSave(WorkspaceSchema);

WorkspaceSchema.index({ id: 1 }, { unique: true });
WorkspaceSchema.index({ orgId: 1, slug: 1 }, { unique: true, sparse: true });
