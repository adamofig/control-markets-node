import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AgentCardsModule, ConversationRuleModule } from '@dataclouder/nest-agent-cards';
import { NestAuthModule } from '@dataclouder/nest-auth';
// import { NotionModule } from '@dataclouder/notion';
import { NestCoreModule } from '@dataclouder/nest-core';

import { AppController } from './app.controller';
import envVariables from './config/environment';
import { UserModule } from './user/user.module';

import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { NestUsersModule } from '@dataclouder/nest-users';
import { AgentsModule } from './agent-tasks/agent-tasks.module';
import { VideoGeneratorModule } from './video-projects/video-project-generator.module';
import { VideoSceneModule } from './video-scene/video-scene.module';
import { NotionAgentsModule } from './notion-agents-module/notion-agents.module';
import { InitModule } from './init/init.module';
import { AuthContextModule } from './auth/auth.module';
import { DeckCommanderModule } from './deck-commander/deck-commander.module';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { CreativeFlowboardModule } from './creative-flowboard/creative-flowboard.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { OrganizationModule } from './organization/organization.module';
import { LeadModule } from './lead/lead.module';
import { NestAiServicesMongodbModule } from '@dataclouder/nest-ai-services-mongodb';
import { NestAiServicesSdkModule } from '@dataclouder/nest-ai-services-sdk';
import { SocialMediaTrackerModule } from './social-media-tracker/social-media-tracker.module';
import { StorageAssetOverrideModule } from './storage-asset/storage-asset-override.module';
import { InspirationSourceModule } from './inspiration-source/inspiration-source.module';
import { RecentResourcesModule } from './recent-resources/recent-resources.module';
import { ChatModule } from './chat/chat.module';
import { HumanResourcesModule } from './human-resources/human-resources.module';
import { McpModule } from '@rekog/mcp-nest';
import { AppMcpModule } from './mcp/mcp.module';
import { McpAuthContextGuard } from './mcp/mcp-auth-context.guard';
import { randomUUID } from 'crypto';
import { BlogEntryModule } from './blog-entry/blog-entry.module';
import { UniversalModule } from './universal/universal.module';
import { AgenticProfileModule } from './agentic-profile/agentic-profile.module';
import { AgentSkillsModule } from './agent-skills/agent-skills.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { WikiSyncModule } from './wiki-sync/wiki-sync.module';
import { LocalAgentModule } from './local-agent/local-agent.module';
import { MentionsModule } from './mentions/mentions.module';
import { CmResourcesModule } from './cm-resources/cm-resources.module';
import { AgenticHeartbeatModule } from './agentic-heartbeat/agentic-heartbeat.module';
import { MessagingModule } from './messaging/messaging.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AgenticConversationModule } from './agentic-conversation/agentic-conversation.module';
import { InboxModule } from './inbox/inbox.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({ load: [envVariables], isGlobal: true }),
    DCMongoDBModule.forRoot(),
    CreativeFlowboardModule,
    ServeStaticModule.forRoot({ rootPath: join(__dirname, '..', 'public'), serveRoot: '/public/', serveStaticOptions: { index: false } }),
    UserModule,
    NestCoreModule,
    AgentCardsModule,
    NestAiServicesSdkModule.forRoot({
      apiBaseUrl: process.env.AI_SERVICES_HOST || 'https://api.dataclouder.com',
      // The credential every outbound call to ai-services carries. `AI_SERVICES_API_KEY` was wired
      // here but never set, and nothing on the far side validated it — which is why ai-services had
      // to stay open for this to work at all. It is the master token ai-services accepts now.
      //
      // These calls run inside flow node processors and schedulers, with no interactive session to
      // forward, so a service credential is the right answer rather than a missing one. Once there
      // is an async-context store, `getAuthContext` on the SDK carries the caller's own credential
      // and only genuine background work falls back to this.
      apiKey: process.env.AI_SERVICES_MASTER_TOKEN || process.env.AI_SERVICES_API_KEY || '',
    }),
    NestAuthModule,
    NestUsersModule,
    AgentsModule,
    NotionAgentsModule,
    VideoGeneratorModule,
    VideoSceneModule,
    InitModule,
    AuthContextModule,
    DeckCommanderModule,
    ConversationRuleModule,
    OrganizationModule,
    LeadModule,
    NestAiServicesMongodbModule,
    NestAiServicesSdkModule,
    StorageAssetOverrideModule,
    SocialMediaTrackerModule,
    InspirationSourceModule,
    RecentResourcesModule,
    ChatModule,
    HumanResourcesModule,
    McpModule.forRoot({
      name: 'control-markets',
      version: '1.0.0',
      // Route-level guard, so it runs AFTER the two global ones registered in `AuthContextModule`
      // (F12) and can read what they resolved. It refuses a request with no identity or no
      // organization, and bridges both onto `request.raw` — the object a tool actually receives
      // under Fastify. See `McpAuthContextGuard` for why the bridge is not optional.
      guards: [McpAuthContextGuard],
      streamableHttp: {
        enableJsonResponse: false,
        sessionIdGenerator: () => randomUUID(),
        statelessMode: false,
      },
    }),
    AppMcpModule,
    BlogEntryModule,
    UniversalModule,
    AgenticProfileModule,
    AgentSkillsModule,
    WorkspacesModule,
    WikiSyncModule,
    LocalAgentModule,
    MentionsModule,
    CmResourcesModule,
    AgenticHeartbeatModule,
    MessagingModule,
    AgenticConversationModule,
    InboxModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
