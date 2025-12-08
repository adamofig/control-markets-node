import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { NotionConversationService } from '../notion-conversation.service';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AgentCardService } from '@dataclouder/nest-agent-cards';
// import { NotionWritesService } from 'libs/nest-notion/src/services/notion-writes.service';
// import { NotionWritesService } from 'src/notion-module/services/notion-writes.service';
@ApiTags('Notion Agent Tasks')
@Controller('api/notion-agent-tasks')
export class NotionAgentTaskController {
  constructor(
    private readonly notionConversationService: NotionConversationService,
    private readonly conversationAiService: AgentCardService
    // private readonly notionWritesService: NotionWritesService
  ) {}

  @Get('start-post-task/:conversation_id')
  async startPostTask(@Param('conversation_id') conversation_id: string, @Query('db_id') db_id: string) {
    // return await this.notionConversationService.startPostTask(pageId);
  }

  @Get('create-agent-page/:agent_id')
  async createAgentPage(@Param('agent_id') agent_id: string) {
    const agentCard = await this.conversationAiService.getConversationById(agent_id);
    const bannerImg = agentCard?.assets?.banner?.url || '';
    const cardImg = agentCard?.assets?.image?.url || '';

    // const notionResponse = await this.notionWritesService.createNewPage({
    //   parentPageId: '195ec05dc75e807e8085ffdb14575a90',
    //   title: 'Agent: ' + agentCard.title,
    //   content: agentCard.characterCard?.data?.first_mes,
    //   coverUrl: bannerImg,
    //   iconUrl: cardImg,
    // });

    // const dbResult = await this.notionWritesService.createInlineDatabase(
    //   notionResponse.page.id,
    //   `Tareas de ${agentCard?.characterCard?.data?.name}`,
    //   {
    //     Name: {
    //       title: {},
    //     },
    //   }
    // );
    // console.log('dbResult', dbResult);

    return null;
  }
}
