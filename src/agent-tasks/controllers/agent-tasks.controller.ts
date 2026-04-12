import { Controller, Get, Param } from '@nestjs/common';
import { AgentTasksService } from '../services/agent-tasks.service';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AgentTaskDocument } from '../schemas/agent-task.schema';
import { EntityMongoController } from '@dataclouder/nest-mongo';

@ApiTags('Agent Tasks')
@Controller('api/agent-tasks')
export class AgentTasksController extends EntityMongoController<AgentTaskDocument> {
  constructor(private readonly agentTasksService: AgentTasksService) {
    super(agentTasksService);
  }

  @Get('execute/:id')
  @ApiOperation({ summary: 'Execute an agent task by ID' })
  @ApiResponse({ status: 200, description: 'Agent task executed successfully' })
  @ApiResponse({ status: 404, description: 'Agent task not found' })
  execute(@Param('id') id: string) {
    console.log('executing task: ', id);
    return this.agentTasksService.execute(id);
  }
}
