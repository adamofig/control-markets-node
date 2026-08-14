import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VideoGeneratorController } from './controllers/video-projects-generator.controller';
import { VideoGeneratorService } from './services/video-project-generator.service';
import { VideoProjectPipelineService } from './services/video-project-pipeline.service';
import { VideoProjectEventsService } from './services/video-project-events.service';
import { VideoSceneModule } from '../video-scene/video-scene.module';
import { VideoGeneratorEntity, VideoGeneratorSchema } from './schemas/video-project.entity';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { SourceEntity, SourceSchema } from 'src/agent-tasks/schemas/sources.schema';
import { VideoSceneEntity, VideoSceneSchema } from '../video-scene/schemas/video-scene.schema';
import { AgentsModule } from 'src/agent-tasks/agent-tasks.module';
import { AgentCardsModule } from '@dataclouder/nest-agent-cards';
import { NestStorageModule } from '@dataclouder/nest-storage';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { HttpModule } from '@nestjs/axios';
import { VideoProjectRenderService } from './services/video-project-render.service';
import { StorageAssetOverrideModule } from '../storage-asset/storage-asset-override.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VideoGeneratorEntity.name, schema: VideoGeneratorSchema },
      { name: SourceEntity.name, schema: SourceSchema },
      // Read-only: used to hydrate the `videoScene` hard relation on project reads.
      { name: VideoSceneEntity.name, schema: VideoSceneSchema },
    ]),
    DCMongoDBModule,
    AgentsModule,
    AgentCardsModule,
    NestStorageModule,
    NestAuthModule,
    // Habla con `control-render` (concat y render maestro del video final).
    HttpModule,
    // El `StorageAssetService` sobre el schema extendido, el mismo que usa el render por escena.
    StorageAssetOverrideModule,
    // Da acceso a `ScenePipelineService`: el proyecto orquesta, la escena sabe generarse.
    VideoSceneModule,
  ],
  controllers: [VideoGeneratorController],
  providers: [VideoGeneratorService, VideoProjectPipelineService, VideoProjectEventsService, VideoProjectRenderService],
  exports: [VideoGeneratorService],
})
export class VideoGeneratorModule {}
