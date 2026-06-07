import { Module } from '@nestjs/common';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { AgentCardsModule } from '@dataclouder/nest-agent-cards';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { OrganizationModule } from '../organization/organization.module';
import { CreativeFlowboardModule } from '../creative-flowboard/creative-flowboard.module';
import { AgentsModule } from '../agent-tasks/agent-tasks.module';
import { BlogEntryModule } from '../blog-entry/blog-entry.module';

@Module({
  imports: [
    NestAuthModule,
    OrganizationModule,
    CreativeFlowboardModule,
    AgentsModule,
    AgentCardsModule,
    BlogEntryModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
