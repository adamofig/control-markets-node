import { ICanvasFlowDiagram, IExecutionResult, IJobExecutionState, ITaskExecutionState } from 'src/agent-flows/models/agent-flows.models';

export interface INodeProcessor {
  processJob(job: IJobExecutionState, task: ITaskExecutionState, flow: ICanvasFlowDiagram): Promise<Partial<IExecutionResult>>;
}
