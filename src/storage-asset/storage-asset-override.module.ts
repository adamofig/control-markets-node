import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestStorageModule, StorageAssetController, StorageAssetEntity, StorageAssetService } from '@dataclouder/nest-storage';
import { StorageAssetExtendedEntity, StorageAssetExtendedSchema } from './schemas/storage-asset-extended.schema';
import { NestAuthModule } from '@dataclouder/nest-auth';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: StorageAssetEntity.name, schema: StorageAssetExtendedSchema }]),
    DCMongoDBModule,
    NestStorageModule,
    NestAuthModule,
  ],
  controllers: [StorageAssetController],
  providers: [StorageAssetService],
  exports: [StorageAssetService],
})
export class StorageAssetOverrideModule {}
