import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VideoSceneController } from './controllers/video-scene.controller';
import { VideoSceneService } from './services/video-scene.service';
import { VideoSceneEntity, VideoSceneSchema } from './schemas/video-scene.schema';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestAuthModule } from '@dataclouder/nest-auth';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: VideoSceneEntity.name, schema: VideoSceneSchema }]),
    DCMongoDBModule,
    NestAuthModule,
  ],
  controllers: [VideoSceneController],
  providers: [VideoSceneService],
  exports: [VideoSceneService],
})
export class VideoSceneModule {}
