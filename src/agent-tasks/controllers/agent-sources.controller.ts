import { Controller, Get, Post, Body, Param, Put, Delete, Query, Patch } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AgentSourcesService } from '../services/agent-sources.service';
import { IAgentSource } from '../models/classes';
import { FiltersConfig } from '@dataclouder/nest-mongo';

@Controller('api/agent-sources')
@ApiTags('Agent Sources')
export class AgentSourcesController {
  constructor(private readonly agentSourcesService: AgentSourcesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all LLM sources' })
  @ApiResponse({ status: 200, description: 'All LLM sources retrieved successfully' })
  findAll() {
    return this.agentSourcesService.findAll();
  }

  @Get('youtube-transcript')
  @ApiOperation({ summary: 'Get an LLM source by ID' })
  @ApiResponse({ status: 200, description: 'LLM source retrieved successfully' })
  @ApiResponse({ status: 404, description: 'LLM source not found' })
  getYoutubeTranscript(@Query('url') url: string) {
    console.log(url);
    return this.agentSourcesService.getYoutubeTranscript(url);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an LLM source by ID' })
  @ApiResponse({ status: 200, description: 'LLM source retrieved successfully' })
  @ApiResponse({ status: 404, description: 'LLM source not found' })
  findOne(@Param('id') id: string) {
    return this.agentSourcesService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new LLM source' })
  @ApiResponse({ status: 201, description: 'LLM source created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  create(@Body() createSourceLLMDto: IAgentSource) {
    return this.agentSourcesService.save(createSourceLLMDto);
  }

  @Post('/query')
  @ApiOperation({ summary: 'Create a new LLM source' })
  @ApiResponse({ status: 201, description: 'LLM source created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  query(@Body() filtersConfig: FiltersConfig) {
    return this.agentSourcesService.queryUsingFiltersConfig(filtersConfig as any);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an LLM source by ID' })
  @ApiResponse({ status: 200, description: 'LLM source updated successfully' })
  @ApiResponse({ status: 404, description: 'LLM source not found' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  update(@Param('id') id: string, @Body() updateSourceLLMDto: IAgentSource) {
    return this.agentSourcesService.partialUpdate(id, updateSourceLLMDto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an LLM source by ID' })
  @ApiResponse({ status: 200, description: 'LLM source updated successfully' })
  @ApiResponse({ status: 404, description: 'LLM source not found' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  patch(@Param('id') id: string, @Body() updateSourceLLMDto: IAgentSource) {
    return this.agentSourcesService.partialUpdateFlattened(id, updateSourceLLMDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an LLM source by ID' })
  @ApiResponse({ status: 200, description: 'LLM source deleted successfully' })
  @ApiResponse({ status: 404, description: 'LLM source not found' })
  delete(@Param('id') id: string) {
    return this.agentSourcesService.delete(id);
  }
}
