import { Controller, Get, Param } from '@nestjs/common';
import { AgentOutcomeJobService } from '../services/agent-job.service';
import { AgentJobDocument } from '../schemas/agent-job.schema';
import { ApiTags } from '@nestjs/swagger';
import { EntityMongoController } from '@dataclouder/nest-mongo';

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
