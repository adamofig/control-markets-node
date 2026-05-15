import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestStorageModule, StorageAssetController, StorageAssetEntity, StorageAssetService } from '@dataclouder/nest-storage';
import { StorageAssetExtendedEntity, StorageAssetExtendedSchema } from './schemas/storage-asset-extended.schema';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { StorageAssetCaptionsService } from './storage-asset-captions.service';
import { StorageAssetCaptionsController } from './storage-asset-captions.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: StorageAssetEntity.name, schema: StorageAssetExtendedSchema }]),
    DCMongoDBModule,
    NestStorageModule,
    NestAuthModule,
    HttpModule,
  ],
  controllers: [StorageAssetController, StorageAssetCaptionsController],
  providers: [StorageAssetService, StorageAssetCaptionsService],
  exports: [StorageAssetService],
})
export class StorageAssetOverrideModule {}
