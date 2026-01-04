import { ICreativeFlowBoard, IExecutionResult, IJobExecutionState, ITaskExecutionState } from 'src/agent-flows/models/agent-flows.models';

export interface INodeProcessor {
  processJob(job: IJobExecutionState, task: ITaskExecutionState, flow: ICreativeFlowBoard): Promise<Partial<IExecutionResult>>;
}
