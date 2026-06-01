import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { IBlogEntry } from '../models/blog-entry.models';
import { AuditDataSchema, IAuditable } from '@dataclouder/nest-core';

export type BlogEntryDocument = BlogEntryEntity & Document;

@Schema({ collection: 'blog_entry', timestamps: true })
export class BlogEntryEntity implements IBlogEntry {
  @Prop({ required: false })
  id: string;

  @Prop({ required: false, default: '' })
  description: string;

  @Prop({ required: false })
  orgId: string;

  @Prop({ required: false })
  name: string;

  @Prop({ required: false})
  slug: string;

  @Prop({ required: false, type: Date })
  published: Date;

  @Prop({ required: false, type: Date })
  updated: Date;

  @Prop({ required: false, default: false })
  draft: boolean;



  @Prop({ required: false, default: '' })
  image: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ required: false, default: 'Tecnología' })
  category: string;

  @Prop({ required: false, default: 'es' })
  lang: string;

  @Prop({ required: false, default: '' })
  content: string;

  @Prop({ required: false })
  filePath: string;

  @Prop({ type: AuditDataSchema, required: false, default: {} })
  auditable: IAuditable;
}

export const BlogEntrySchema = SchemaFactory.createForClass(BlogEntryEntity);

addIdAfterSave(BlogEntrySchema);

BlogEntrySchema.index({ id: 1 }, { unique: true });
BlogEntrySchema.index({ orgId: 1 });

BlogEntrySchema.index({ slug: 1 }, { unique: false }); // TODO just for now i don't want to index this
BlogEntrySchema.index({ name: 'text', description: 'text', content: 'text' });
