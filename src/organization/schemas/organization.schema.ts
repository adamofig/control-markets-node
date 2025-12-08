import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { IOrganization } from '../models/organization.models';
export type OrganizationDocument = OrganizationEntity & Document;

@Schema({ collection: 'organizations', timestamps: true })
export class OrganizationEntity implements IOrganization {
  @Prop({ required: false })
  id: string;

  @Prop({ required: false })
  name: string;

  @Prop({ required: false })
  description: string;

  @Prop({ required: false })
  type: string;

  @Prop({ required: false, default: [] })
  guests: any[];
}

export const OrganizationSchema = SchemaFactory.createForClass(OrganizationEntity);

addIdAfterSave(OrganizationSchema);

OrganizationSchema.index({ id: 1 }, { unique: true });
