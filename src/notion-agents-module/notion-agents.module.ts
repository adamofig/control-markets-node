import { Module } from '@nestjs/common';
// import { NotionModule } from 'src/notion-module/notion.module';
import { NotionConversationController } from './controllers/notion-conversation.controller';
import { NotionConversationService } from './notion-conversation.service';
import { AgentCardsModule } from '@dataclouder/nest-agent-cards';
import { HttpModule } from '@nestjs/axios';
import { NotionAgentTaskController } from './controllers/notion-agent-task.controller';
import { NestAuthModule } from '@dataclouder/nest-auth';
// import { NotionModule } from 'libs/nest-notion/src';

// `NestAuthModule`: Nest instantiates `ProjectAuthGuard` (F10, class-level) inside this module, so
// `FirebaseService` has to be visible here. Same pattern as every other module mounting the guard.
@Module({
  imports: [AgentCardsModule, HttpModule, NestAuthModule],
  controllers: [NotionConversationController, NotionAgentTaskController],
  providers: [NotionConversationService],
  exports: [NotionConversationService],
})
export class NotionAgentsModule {}
