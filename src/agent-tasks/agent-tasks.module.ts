import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentTasksController } from './controllers/agent-tasks.controller';
import { AgentTasksService } from './services/agent-tasks.service';
import { AgentTaskEntity, AgentTaskSchema } from './schemas/agent-task.schema';
import { HttpModule } from '@nestjs/axios';

import { AgentCardsModule } from '@dataclouder/nest-agent-cards';
// import { NotionModule } from 'libs/nest-notion/src';
import { AgentJobsController } from './controllers/agent-jobs.controller';
import { AgentOutcomeJobService } from './services/agent-job.service';
import { AgentJobEntity, AgentJobSchema } from './schemas/agent-job.schema';
import { SourceEntity, SourceSchema } from './schemas/sources.schema';
import { SourcesService } from './services/sources.service';
import { SourcesController } from './controllers/sources.controller';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestStorageModule } from '@dataclouder/nest-storage';
import { AgentDistributionChannelsController } from './controllers/agent-distribution-channels.controller';
import { AgentDistributionChannelService } from './services/agent-distribution-channel.service';
import { NestAiServicesSdkModule } from '@dataclouder/nest-ai-services-sdk';
import { NestAuthModule } from '@dataclouder/nest-auth';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: AgentTaskEntity.name, schema: AgentTaskSchema }]),
    MongooseModule.forFeature([{ name: AgentJobEntity.name, schema: AgentJobSchema }]),
    MongooseModule.forFeature([{ name: SourceEntity.name, schema: SourceSchema }]),
    DCMongoDBModule,
    HttpModule,
    AgentCardsModule,
    // NotionModule,
    NestStorageModule,
    NestAiServicesSdkModule,
    NestAuthModule,
  ],
  controllers: [AgentTasksController, AgentJobsController, SourcesController, AgentDistributionChannelsController],
  providers: [AgentTasksService, AgentOutcomeJobService, SourcesService, AgentDistributionChannelService],
  exports: [AgentTasksService, AgentOutcomeJobService, SourcesService],
})
export class AgentsModule {}
