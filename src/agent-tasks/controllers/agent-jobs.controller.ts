import { Controller, Get, Post, Put, Delete, Body, Param, HttpStatus, HttpException } from '@nestjs/common';
import { AgentOutcomeJobService } from '../services/agent-job.service';
import { AgentJobEntity } from '../schemas/agent-job.schema';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FiltersConfig, IQueryResponse } from '@dataclouder/nest-mongo';

@Controller('api/agent-jobs')
@ApiTags('Agent Jobs')
export class AgentJobsController {
  constructor(private readonly agentJobService: AgentOutcomeJobService) {}

  @Post()
  async create(@Body() createJobDto: Partial<AgentJobEntity>) {
    try {
      return await this.agentJobService.create(createJobDto);
    } catch (error) {
      throw new HttpException('Failed to create agent job', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get()
  async findAll() {
    try {
      return await this.agentJobService.findAll();
    } catch (error) {
      throw new HttpException('Failed to fetch agent jobs', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      const job = await this.agentJobService.findOne(id);
      if (!job) {
        throw new HttpException('Agent job not found', HttpStatus.NOT_FOUND);
      }
      return job;
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        throw error;
      }
      throw new HttpException('Failed to fetch agent job', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateJobDto: Partial<AgentJobEntity>) {
    try {
      const updatedJob = await this.agentJobService.update(id, updateJobDto);
      if (!updatedJob) {
        throw new HttpException('Agent job not found', HttpStatus.NOT_FOUND);
      }
      return updatedJob;
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        throw error;
      }
      throw new HttpException('Failed to update agent job', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    try {
      const deletedJob = await this.agentJobService.delete(id);
      if (!deletedJob) {
        throw new HttpException('Agent job not found', HttpStatus.NOT_FOUND);
      }
      return deletedJob;
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        throw error;
      }
      throw new HttpException('Failed to delete agent job', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('status/:status')
  async findByStatus(@Param('status') status: string) {
    try {
      return await this.agentJobService.findByStatus(status);
    } catch (error) {
      throw new HttpException('Failed to fetch agent jobs by status', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('task/:taskId')
  async findByTaskId(@Param('taskId') taskId: string) {
    try {
      return await this.agentJobService.findByTaskId(taskId);
    } catch (error) {
      throw new HttpException('Failed to fetch agent jobs by task ID', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('agent/:agentId')
  async findByAgentId(@Param('agentId') agentId: string) {
    try {
      return await this.agentJobService.findByAgentId(agentId);
    } catch (error) {
      throw new HttpException('Failed to fetch agent jobs by agent ID', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Queries generic entities using a filter configuration
   * @param filterConfig - Configuration for filtering, sorting, and pagination
   * @returns Promise resolving to query results and metadata
   */
  @Post('query')
  @ApiOperation({ summary: 'Create a new newComponent item' })
  async query(@Body() filterConfig: FiltersConfig): Promise<IQueryResponse<AgentJobEntity>> {
    return await this.agentJobService.queryUsingFiltersConfig(filterConfig);
  }
}
