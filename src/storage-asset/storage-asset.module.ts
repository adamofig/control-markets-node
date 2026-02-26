import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StorageAssetController } from './controllers/storage-asset.controller';
import { StorageAssetService } from './services/storage-asset.service';
import { StorageAssetEntity, StorageAssetSchema } from './schemas/storage-asset.schema';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestStorageModule } from '@dataclouder/nest-storage';

@Module({
  imports: [MongooseModule.forFeature([{ name: StorageAssetEntity.name, schema: StorageAssetSchema }]), DCMongoDBModule, NestStorageModule],
  controllers: [StorageAssetController],
  providers: [StorageAssetService],
  exports: [StorageAssetService],
})
export class StorageAssetModule {}
