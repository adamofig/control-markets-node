import { Module } from '@nestjs/common';
// import { NotionModule } from 'src/notion-module/notion.module';
import { NotionConversationController } from './controllers/notion-conversation.controller';
import { NotionConversationService } from './notion-conversation.service';
import { AgentCardsModule } from '@dataclouder/nest-agent-cards';
import { HttpModule } from '@nestjs/axios';
import { NotionAgentTaskController } from './controllers/notion-agent-task.controller';
// import { NotionModule } from 'libs/nest-notion/src';
@Module({
  imports: [AgentCardsModule, HttpModule],
  controllers: [NotionConversationController, NotionAgentTaskController],
  providers: [NotionConversationService],
  exports: [NotionConversationService],
})
export class NotionAgentsModule {}
