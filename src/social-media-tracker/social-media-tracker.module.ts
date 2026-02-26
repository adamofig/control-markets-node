import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SocialMediaTrackerController } from './controllers/social-media-tracker.controller';
import { SocialMediaTrackerService } from './services/social-media-tracker.service';
import { SocialMediaTrackerEntity, SocialMediaTrackerSchema } from './schemas/social-media-tracker.schema';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestStorageModule } from '@dataclouder/nest-storage';

@Module({
  imports: [MongooseModule.forFeature([{ name: SocialMediaTrackerEntity.name, schema: SocialMediaTrackerSchema }]), DCMongoDBModule, NestStorageModule],
  controllers: [SocialMediaTrackerController],
  providers: [SocialMediaTrackerService],
  exports: [SocialMediaTrackerService],
})
export class SocialMediaTrackerModule {}
