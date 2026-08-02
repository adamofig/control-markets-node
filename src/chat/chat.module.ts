import { Module } from '@nestjs/common';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { AgentCardsModule } from '@dataclouder/nest-agent-cards';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { OrganizationModule } from '../organization/organization.module';
import { CreativeFlowboardModule } from '../creative-flowboard/creative-flowboard.module';
import { AgentsModule } from '../agent-tasks/agent-tasks.module';
import { BlogEntryModule } from '../blog-entry/blog-entry.module';
import { KeyBalancerModule } from '../key-balancer/key-balancer.module';
import { InboxModule } from '../inbox/inbox.module';
import { UiCapabilityRegistryService } from './context/ui-capability-registry.service';
import { UiContextPromptComposerService } from './context/ui-context-prompt-composer.service';
import { UiContextSanitizerService } from './context/ui-context-sanitizer.service';

@Module({
  imports: [
    NestAuthModule,
    OrganizationModule,
    CreativeFlowboardModule,
    AgentsModule,
    AgentCardsModule,
    BlogEntryModule,
    KeyBalancerModule,
    InboxModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, UiContextSanitizerService, UiContextPromptComposerService, UiCapabilityRegistryService],
  exports: [ChatService],
})
export class ChatModule {}
