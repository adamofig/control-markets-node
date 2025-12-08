import { Controller, Get, Post, Body, Param, Put, Delete } from '@nestjs/common';
import { AgentTasksService } from '../services/agent-tasks.service';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ILlmTask } from '../models/classes';
import { FiltersConfig, IQueryResponse } from '@dataclouder/nest-mongo';
import { AgentTaskEntity } from '../schemas/agent-task.schema';

@Controller('api/agent-tasks')
export class AgentTasksController {
  constructor(private readonly agentTasksService: AgentTasksService) {}

  @Get()
  @ApiOperation({ summary: 'Get all agent tasks' })
  @ApiResponse({ status: 200, description: 'All agent tasks retrieved successfully' })
  findAll() {
    return this.agentTasksService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an agent task by ID' })
  @ApiResponse({ status: 200, description: 'Agent task retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Agent task not found' })
  findOne(@Param('id') id: string) {
    return this.agentTasksService.findOne(id);
  }

  @Get('execute/:id')
  @ApiOperation({ summary: 'Execute an agent task by ID' })
  @ApiResponse({ status: 200, description: 'Agent task executed successfully' })
  @ApiResponse({ status: 404, description: 'Agent task not found' })
  execute(@Param('id') id: string) {
    console.log('executing task: ', id);
    return this.agentTasksService.execute(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new agent task' })
  @ApiResponse({ status: 201, description: 'Agent task created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  create(@Body() createAgentTaskDto: ILlmTask) {
    console.log(createAgentTaskDto);
    return this.agentTasksService.save(createAgentTaskDto);
  }

  @Post('query')
  @ApiOperation({ summary: 'Create a new generic item' })
  @ApiResponse({ status: 201, description: 'The item has been successfully created.', type: AgentTaskEntity })
  async query(@Body() filterConfig: FiltersConfig): Promise<IQueryResponse<AgentTaskEntity>> {
    return await this.agentTasksService.queryUsingFiltersConfig(filterConfig);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an agent task by ID' })
  @ApiResponse({ status: 200, description: 'Agent task updated successfully' })
  @ApiResponse({ status: 404, description: 'Agent task not found' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  update(@Param('id') id: string, @Body() updateAgentTaskDto: any) {
    return this.agentTasksService.update(id, updateAgentTaskDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an agent task by ID' })
  @ApiResponse({ status: 200, description: 'Agent task deleted successfully' })
  @ApiResponse({ status: 404, description: 'Agent task not found' })
  delete(@Param('id') id: string) {
    return this.agentTasksService.delete(id);
  }
}
