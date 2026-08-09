import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VideoGeneratorController } from './controllers/video-projects-generator.controller';
import { VideoGeneratorService } from './services/video-project-generator.service';
import { VideoGeneratorEntity, VideoGeneratorSchema } from './schemas/video-project.entity';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { SourceEntity, SourceSchema } from 'src/agent-tasks/schemas/sources.schema';
import { VideoSceneEntity, VideoSceneSchema } from '../video-scene/schemas/video-scene.schema';
import { AgentsModule } from 'src/agent-tasks/agent-tasks.module';
import { AgentCardsModule } from '@dataclouder/nest-agent-cards';
import { NestStorageModule } from '@dataclouder/nest-storage';
import { NestAuthModule } from '@dataclouder/nest-auth';

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
  ],
  controllers: [VideoGeneratorController],
  providers: [VideoGeneratorService],
  exports: [VideoGeneratorService],
})
export class VideoGeneratorModule {}
