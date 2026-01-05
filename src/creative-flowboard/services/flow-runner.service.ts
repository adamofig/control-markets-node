import { Injectable, Logger } from '@nestjs/common';
import { ICreativeFlowBoard, IExecutionResult, IFlowExecutionState, IJobExecutionState, StatusJob } from '../models/creative-flowboard.models';
import { FlowExecutionStateService } from './flow-execution-state.service';
import { FlowsDbStateService } from './flows-db-state.service';
import { NodeProcessorService } from './node-processor.service';
import { FlowEventsService } from './flow-events.service';

@Injectable()
export class FlowRunnerService {
  private logger = new Logger(FlowRunnerService.name);

  constructor(
    private flowsDbStateService: FlowsDbStateService,
    private nodeProcessorService: NodeProcessorService,
    private readonly flowExecutionStateService: FlowExecutionStateService,
    private readonly flowEventsService: FlowEventsService
  ) {}

  private async updateExecutionState(flowExecutionState: IFlowExecutionState): Promise<void> {
    await this.flowsDbStateService.updateFirestore(flowExecutionState.flowExecutionId, flowExecutionState);
    await this.flowExecutionStateService.save(flowExecutionState);
    this.flowEventsService.emit(flowExecutionState.flowId, flowExecutionState);
  }

  public async initExecution(flowDiagram: ICreativeFlowBoard, flowExecutionState: IFlowExecutionState): Promise<Partial<IExecutionResult>[]> {
    // TODO: antes no regresaba nada.
    this.logger.verbose(`initExecution() Running flow ${flowDiagram.id}`);
    flowExecutionState.status = StatusJob.IN_PROGRESS;
    await this.updateExecutionState(flowExecutionState);

    const results: Partial<IExecutionResult>[] = [];

    for (const task of flowExecutionState.tasks) {
      task.status = StatusJob.IN_PROGRESS;

      for (const job of task.jobs) {
        job.status = StatusJob.IN_PROGRESS;
        await this.updateExecutionState(flowExecutionState);
        console.log(`Processing job type ${job.nodeType} for task ${task.entityId}`);

        const result = await this.nodeProcessorService.processJob(job as IJobExecutionState, task, flowDiagram);
        results.push(result);

        job.status = result.status;
        job.outputEntityId = result.outputEntityId;
        job.resultType = result.resultType;
        // TODO: i need to check this part to see.
        await this.updateExecutionState(flowExecutionState);
      }
      task.status = StatusJob.COMPLETED;
      await this.updateExecutionState(flowExecutionState);
    }
    flowExecutionState.status = StatusJob.COMPLETED;
    await this.updateExecutionState(flowExecutionState);
    return results;
  }
}
