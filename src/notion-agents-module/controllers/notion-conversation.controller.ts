import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { NotionConversationService } from '../notion-conversation.service';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Notion Conversation')
@Controller('notion-conversation')
export class NotionConversationController {
  constructor(private readonly notionConversationService: NotionConversationService) {}

  @Get('init-agent-conversation-task/:agentId/:db_id')
  async initAgentConversationTask(@Param('agentId') agentId: string, @Param('db_id') db_id: string) {
    agentId = '67a8e12e3a6c454dc2b56e53';
    db_id = '195ec05d-c75e-80a4-83fe-e499a47f37dc';
    return this.notionConversationService.initAgentConversationTask(agentId, db_id);

    // TODO: Este metodo en realidad no necesita conversciones/agentscards asi mover a notion-module
    // return await this.notionConversationService.initAgentConversationTask(agentId, db_id);
  }
}
