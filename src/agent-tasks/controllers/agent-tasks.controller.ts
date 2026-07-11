import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { AgentTasksService } from '../services/agent-tasks.service';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AgentTaskDocument } from '../schemas/agent-task.schema';
import { EntityMongoController } from '@dataclouder/nest-mongo';
import { ISubtask, SubtaskStatus } from '../models/classes';

export class UpdateSubtaskStatusDto {
  status: SubtaskStatus;
  completedBy?: string;
}

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

  @Put(':id/subtasks')
  @ApiOperation({ summary: 'Replace the subtask checklist of a task (add/edit/delete/reorder)' })
  @ApiResponse({ status: 200, description: 'Subtasks updated; parent status recalculated' })
  setSubtasks(@Param('id') id: string, @Body() subtasks: ISubtask[]) {
    return this.agentTasksService.setSubtasks(id, subtasks);
  }

  @Put(':id/subtasks/:subtaskId/status')
  @ApiOperation({ summary: 'Update a single subtask status; auto-completes/reopens the parent task' })
  @ApiResponse({ status: 200, description: 'Subtask updated; returns the full updated task' })
  updateSubtaskStatus(@Param('id') id: string, @Param('subtaskId') subtaskId: string, @Body() dto: UpdateSubtaskStatusDto) {
    return this.agentTasksService.updateSubtaskStatus(id, subtaskId, dto.status, dto.completedBy);
  }
}
