import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VideoSceneController } from './controllers/video-scene.controller';
import { VideoSceneService } from './services/video-scene.service';
import { VideoSceneEventsService } from './services/video-scene-events.service';
import { VideoSceneEntity, VideoSceneSchema } from './schemas/video-scene.schema';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { HttpModule } from '@nestjs/axios';
import { NestStorageModule } from '@dataclouder/nest-storage';
import { StorageAssetOverrideModule } from '../storage-asset/storage-asset-override.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: VideoSceneEntity.name, schema: VideoSceneSchema }]),
    DCMongoDBModule,
    NestAuthModule,
    HttpModule,
    NestStorageModule,
    StorageAssetOverrideModule,
  ],
  controllers: [VideoSceneController],
  providers: [VideoSceneService, VideoSceneEventsService],
  exports: [VideoSceneService, VideoSceneEventsService],
})
export class VideoSceneModule {}
