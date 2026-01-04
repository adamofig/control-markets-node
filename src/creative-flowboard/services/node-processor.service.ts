import { Injectable, Logger } from '@nestjs/common';
import { ICreativeFlowBoard, IExecutionResult, IJobExecutionState, ITaskExecutionState, NodeType } from '../models/creative-flowboard.models';
import { AgentNodeProcessor } from './node-processors/agent-node.processor';
import { OutcomeNodeProcessor } from './node-processors/outcome-node.processor';
import { INodeProcessor } from './node-processors/inode.processor';
import { VideoGenNodeProcessor } from './node-processors/video-processor';

@Injectable()
export class NodeProcessorService {
  private processors: Map<NodeType, INodeProcessor> = new Map();

  private logger = new Logger(NodeProcessorService.name);

  constructor(
    private agentNodeProcessor: AgentNodeProcessor,
    private outcomeNodeProcessor: OutcomeNodeProcessor,
    private assetsNodeProcessor: VideoGenNodeProcessor
  ) {
    this.processors.set(NodeType.AgentNodeComponent, this.agentNodeProcessor);
    this.processors.set(NodeType.OutcomeNodeComponent, this.outcomeNodeProcessor);
    this.processors.set(NodeType.AssetsNodeComponent, this.assetsNodeProcessor);
  }

  async processJob(job: IJobExecutionState, task: ITaskExecutionState, flow: ICreativeFlowBoard): Promise<Partial<IExecutionResult>> {
    if (job.nodeType === NodeType.AgentNodeComponent) {
      return this.agentNodeProcessor.processJob(job, task, flow);
    }

    if (job.nodeType === NodeType.OutcomeNodeComponent) {
      return this.outcomeNodeProcessor.processJob(job, task, flow);
    }
    if (job.nodeType === NodeType.AssetsNodeComponent) {
      console.log('Processing AssetsNodeComponent');
      return this.assetsNodeProcessor.processJob(job, task, flow);
    } else {
      this.logger.error(`Dev Create a new Porcesor for node type: ${job.nodeType}`);
      throw new Error(`No processor found for node type: ${job.nodeType}`);
    }
  }
}
