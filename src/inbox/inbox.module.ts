import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { AgentCardsModule } from '@dataclouder/nest-agent-cards';
import { AgenticProfileModule } from '../agentic-profile/agentic-profile.module';
import { LocalAgentModule } from '../local-agent/local-agent.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { UserModule } from '../user/user.module';
import { AgentsModule } from '../agent-tasks/agent-tasks.module';
import { InboxConversationEntity, InboxConversationSchema } from './schemas/inbox-conversation.schema';
import { InboxMembershipEntity, InboxMembershipSchema } from './schemas/inbox-membership.schema';
import { InboxMessageEntity, InboxMessageSchema } from './schemas/inbox-message.schema';
import { InboxController } from './controllers/inbox.controller';
import { InboxAgentController } from './controllers/inbox-agent.controller';
import { InboxPatDelegationGuard } from './guards/inbox-pat-delegation.guard';
import { InboxAgentDispatcherService } from './services/inbox-agent-dispatcher.service';
import { InboxAgentIdentityService } from './services/inbox-agent-identity.service';
import { InboxAgentMessageService } from './services/inbox-agent-message.service';
import { InboxConversationService } from './services/inbox-conversation.service';
import { InboxEventService } from './services/inbox-event.service';
import { InboxIdentityService } from './services/inbox-identity.service';
import { InboxMembershipService } from './services/inbox-membership.service';
import { InboxMessageService } from './services/inbox-message.service';
import { InboxTaskAutomationService } from './services/inbox-task-automation.service';

@Module({
  imports: [
    NestAuthModule,
    UserModule,
    AgentsModule,
    AgenticProfileModule,
    AgentCardsModule,
    LocalAgentModule,
    WorkspacesModule,
    MongooseModule.forFeature([
      { name: InboxConversationEntity.name, schema: InboxConversationSchema },
      { name: InboxMembershipEntity.name, schema: InboxMembershipSchema },
      { name: InboxMessageEntity.name, schema: InboxMessageSchema },
    ]),
  ],
  controllers: [InboxController, InboxAgentController],
  providers: [
    InboxConversationService,
    InboxEventService,
    InboxIdentityService,
    InboxAgentIdentityService,
    InboxAgentMessageService,
    InboxAgentDispatcherService,
    InboxPatDelegationGuard,
    InboxMembershipService,
    InboxMessageService,
    InboxTaskAutomationService,
  ],
  exports: [InboxConversationService, InboxMembershipService, InboxMessageService, InboxIdentityService, InboxAgentIdentityService, InboxAgentMessageService],
})
export class InboxModule {}
