import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { StorageAssetEntity } from '@dataclouder/nest-storage';

export type StorageAssetExtendedDocument = StorageAssetExtendedEntity & Document;

@Schema({ collection: 'storage_assets', timestamps: true })
export class StorageAssetExtendedEntity extends StorageAssetEntity {
  @Prop({ required: false, type: String })
  orgId: string;
}

export const StorageAssetExtendedSchema = SchemaFactory.createForClass(StorageAssetExtendedEntity);

addIdAfterSave(StorageAssetExtendedSchema);

StorageAssetExtendedSchema.index({ id: 1 }, { unique: true });
StorageAssetExtendedSchema.index({ orgId: 1 });
