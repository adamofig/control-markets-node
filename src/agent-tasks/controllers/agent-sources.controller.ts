import { Controller, Get, Patch, Body, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentSourcesService } from '../services/agent-sources.service';
import { AgentSourceDocument } from '../schemas/agent-sources.schema';
import { EntityMongoController } from '@dataclouder/nest-mongo';

@Controller('api/agent-sources')
@ApiTags('Agent Sources')
export class AgentSourcesController extends EntityMongoController<AgentSourceDocument> {
  constructor(private readonly agentSourcesService: AgentSourcesService) {
    super(agentSourcesService);
  }

  @Get('youtube-transcript')
  @ApiOperation({ summary: 'Get YouTube transcript by URL' })
  getYoutubeTranscript(@Query('url') url: string) {
    console.log(url);
    return this.agentSourcesService.getYoutubeTranscript(url);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partially update an agent source using dot-notation flattening' })
  patch(@Param('id') id: string, @Body() updateSourceLLMDto: any) {
    return this.agentSourcesService.partialUpdateFlattened(id, updateSourceLLMDto);
  }
}
