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
import { AgentSourceEntity, AgentSourceSchema } from './schemas/agent-sources.schema';
import { AgentSourcesService } from './services/agent-sources.service';
import { AgentSourcesController } from './controllers/agent-sources.controller';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestStorageModule } from '@dataclouder/nest-storage';
import { NestVertexModule } from '@dataclouder/nest-vertex';
import { AgentDistributionChannelsController } from './controllers/agent-distribution-channels.controller';
import { AgentDistributionChannelService } from './services/agent-distribution-channel.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: AgentTaskEntity.name, schema: AgentTaskSchema }]),
    MongooseModule.forFeature([{ name: AgentJobEntity.name, schema: AgentJobSchema }]),
    MongooseModule.forFeature([{ name: AgentSourceEntity.name, schema: AgentSourceSchema }]),
    DCMongoDBModule,
    HttpModule,
    AgentCardsModule,
    // NotionModule,
    NestStorageModule,
    NestVertexModule,
  ],
  controllers: [AgentTasksController, AgentJobsController, AgentSourcesController, AgentDistributionChannelsController],
  providers: [AgentTasksService, AgentOutcomeJobService, AgentSourcesService, AgentDistributionChannelService],
  exports: [AgentTasksService, AgentOutcomeJobService, AgentSourcesService],
})
export class AgentsModule {}
