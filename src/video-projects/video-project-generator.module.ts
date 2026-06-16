import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VideoGeneratorController } from './controllers/video-projects-generator.controller';
import { VideoGeneratorService } from './services/video-project-generator.service';
import { VideoGeneratorEntity, VideoGeneratorSchema } from './schemas/video-project.entity';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { AgentSourceEntity, AgentSourceSchema } from 'src/agent-tasks/schemas/agent-sources.schema';
import { AgentsModule } from 'src/agent-tasks/agent-tasks.module';
import { AgentCardsModule } from '@dataclouder/nest-agent-cards';
import { NestStorageModule } from '@dataclouder/nest-storage';
import { NestAuthModule } from '@dataclouder/nest-auth';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VideoGeneratorEntity.name, schema: VideoGeneratorSchema },
      { name: AgentSourceEntity.name, schema: AgentSourceSchema },
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
