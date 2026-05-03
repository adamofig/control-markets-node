import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SocialMediaTrackerController } from './controllers/social-media-tracker.controller';
import { SocialMediaTrackerService } from './services/social-media-tracker.service';
import { SocialMediaTrackerEntity, SocialMediaTrackerSchema } from './schemas/social-media-tracker.schema';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { StorageAssetOverrideModule } from '../storage-asset/storage-asset-override.module';
import { NestAuthModule } from '@dataclouder/nest-auth';

@Module({
  imports: [MongooseModule.forFeature([{ name: SocialMediaTrackerEntity.name, schema: SocialMediaTrackerSchema }]), DCMongoDBModule, StorageAssetOverrideModule, NestAuthModule],
  controllers: [SocialMediaTrackerController],
  providers: [SocialMediaTrackerService],
  exports: [SocialMediaTrackerService],
})
export class SocialMediaTrackerModule {}
