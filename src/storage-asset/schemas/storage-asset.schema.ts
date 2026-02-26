import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { IStorageAsset } from '../models/storage-asset.models';
import { AuditDataSchema, IAuditable } from '@dataclouder/nest-core';
import { CloudFileStorage } from '@dataclouder/nest-storage';
export type StorageAssetDocument = StorageAssetEntity & Document;

@Schema({ collection: 'StorageAsset', timestamps: true })
export class StorageAssetEntity implements IStorageAsset {
  @Prop({ required: false })
  id: string;

  @Prop({ required: false })
  name: string;

  @Prop({ required: false })
  type: string;

  @Prop({ required: false })
  description: string;

  @Prop({ required: false, type: Object })
  storage: CloudFileStorage;



  @Prop({ type: AuditDataSchema, required: false, default: {} })
  auditable: IAuditable;
}

export const StorageAssetSchema = SchemaFactory.createForClass(StorageAssetEntity);

addIdAfterSave(StorageAssetSchema);

StorageAssetSchema.index({ id: 1 }, { unique: true });
