import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AppGuard } from '@dataclouder/nest-core';
import { ProjectAuthGuard } from 'src/user/project-auth.guard';
import { AgentOutcomeJobService } from '../services/agent-job.service';
import { AgentJobDocument } from '../schemas/agent-job.schema';
import { ApiTags } from '@nestjs/swagger';
import { EntityMongoController } from '@dataclouder/nest-mongo';

@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/agent-jobs')
@ApiTags('Agent Jobs')
export class AgentJobsController extends EntityMongoController<AgentJobDocument> {
  constructor(private readonly agentJobService: AgentOutcomeJobService) {
    super(agentJobService);
  }

  @Get('status/:status')
  async findByStatus(@Param('status') status: string) {
    return await this.agentJobService.findByStatus(status);
  }

  @Get('task/:taskId')
  async findByTaskId(@Param('taskId') taskId: string) {
    return await this.agentJobService.findByTaskId(taskId);
  }

  @Get('agent/:agentId')
  async findByAgentId(@Param('agentId') agentId: string) {
    return await this.agentJobService.findByAgentId(agentId);
  }
}
