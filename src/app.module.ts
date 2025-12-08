import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AgentCardsModule, ConversationRuleModule } from '@dataclouder/nest-agent-cards';
import { NestAuthModule } from '@dataclouder/nest-auth';
// import { NotionModule } from '@dataclouder/notion';
import { LessonsModule } from '@dataclouder/nest-lessons';
import { NestCoreModule } from '@dataclouder/nest-core';

import { AppController } from './app.controller';
import envVariables from './config/environment';
import { UserModule } from './user/user.module';
import { TestModule } from './test/test.module';

import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { NestWhisperModule } from '@dataclouder/nest-whisper';
import { NestVertexModule } from '@dataclouder/nest-vertex';
import { NestUsersModule } from '@dataclouder/nest-users';
import { AgentsModule } from './agent-tasks/agent-tasks.module';
import { VideoGeneratorModule } from './video-projects/video-project-generator.module';
import { NotionAgentsModule } from './notion-agents-module/notion-agents.module';
import { InitModule } from './init/init.module';
import { DeckCommanderModule } from './deck-commander/deck-commander.module';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { AgentFlowsModule } from './agent-flows/agent-flows.module';
import { TiktokBotModule } from './tiktok-bot/tiktok-bot.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { OrganizationModule } from './organization/organization.module';
import { LeadModule } from './lead/lead.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ConfigModule.forRoot({ load: [envVariables], isGlobal: true }),
    DCMongoDBModule.forRoot(),
    AgentFlowsModule,
    ServeStaticModule.forRoot({ rootPath: join(__dirname, '..', 'public'), serveRoot: '/public/', serveStaticOptions: { index: false } }),
    UserModule,
    NestCoreModule,
    TestModule,
    AgentCardsModule,
    LessonsModule,
    NestVertexModule.forRoot({
      apiKey: null,
      apiBaseUrl: process.env.AI_SERVICES_HOST || '',
    }),
    NestAuthModule,
    NestWhisperModule,
    NestUsersModule,
    AgentsModule,
    NotionAgentsModule,
    VideoGeneratorModule,
    InitModule,
    DeckCommanderModule,
    TiktokBotModule,
    ConversationRuleModule,
    OrganizationModule,
    LeadModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
