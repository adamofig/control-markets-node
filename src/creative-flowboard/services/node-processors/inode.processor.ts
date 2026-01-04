import { ICreativeFlowBoard, IExecutionResult, IJobExecutionState, ITaskExecutionState } from 'src/creative-flowboard/models/creative-flowboard.models';

export interface INodeProcessor {
  processJob(job: IJobExecutionState, task: ITaskExecutionState, flow: ICreativeFlowBoard): Promise<Partial<IExecutionResult>>;
}
