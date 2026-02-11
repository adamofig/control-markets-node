import { Injectable, Logger } from '@nestjs/common';
import { ICreativeFlowBoard, IExecutionResult, IJobExecutionState, ITaskExecutionState, NodeType } from '../models/creative-flowboard.models';
import { CompletionNodeProcessor } from './node-processors/completion-node.processor';
import { OutcomeNodeProcessor } from './node-processors/outcome-node.processor';
import { INodeProcessor } from './node-processors/inode.processor';
import { VideoGenNodeProcessor } from './node-processors/video-processor';
import { NanoBananaNodeProcessor } from './node-processors/nanobanana-node.processor';

@Injectable()
export class NodeProcessorService {
  private processors: Map<NodeType, INodeProcessor> = new Map();

  private logger = new Logger(NodeProcessorService.name);

  constructor(
    private completionNodeProcessor: CompletionNodeProcessor,
    private outcomeNodeProcessor: OutcomeNodeProcessor,
    private assetsNodeProcessor: VideoGenNodeProcessor,
    private nanoBananaNodeProcessor: NanoBananaNodeProcessor
  ) {
    this.processors.set(NodeType.AgentNodeComponent, this.completionNodeProcessor);
    this.processors.set(NodeType.OutcomeNodeComponent, this.outcomeNodeProcessor);
    this.processors.set(NodeType.AssetsNodeComponent, this.assetsNodeProcessor);
    this.processors.set(NodeType.VideoGenNodeComponent, this.assetsNodeProcessor);
    this.processors.set(NodeType.NanoBananaNodeComponent, this.nanoBananaNodeProcessor);
  }

  async processJob(job: IJobExecutionState, task: ITaskExecutionState, flow: ICreativeFlowBoard): Promise<Partial<IExecutionResult>> {
    this.logger.log(`Processing job: [Input: ${job.nodeType}] -> [Process: ${job.processNodeType}]`);

    // 1. Special Handling: NanoBanana processing Assets
    if (job.processNodeType === NodeType.NanoBananaNodeComponent && job.nodeType === NodeType.AssetsNodeComponent) {
      this.logger.log('Special handling for NanoBananaNodeComponent with AssetsNodeComponent');
      return this.nanoBananaNodeProcessor.processJob(job, task, flow);
    }

    if (job.processNodeType === NodeType.TaskNodeComponent && job.nodeType === NodeType.AgentNodeComponent) {
      this.logger.log('Special handling for TaskNodeComponent with CompletionNodeComponent');
      return this.completionNodeProcessor.processJob(job, task, flow);
    }

    if (job.processNodeType === NodeType.TaskNodeComponent && job.nodeType !== NodeType.AgentNodeComponent) {
      this.logger.log('Direct LLM call for TaskNodeComponent');
      return this.processJobCompletion(job, task, flow);
    }

    // 2. Primary Routing: By Process Node Type
    const processProcessor = this.processors.get(job.processNodeType);
    if (processProcessor) {
      return processProcessor.processJob(job, task, flow);
    }

    // 3. Fallback/Original Routing: By Input Node Type
    // Note: We keep this to maintain compatibility with existing flows where routing was based on the input node.
    const inputProcessor = this.processors.get(job.nodeType);
    if (inputProcessor) {
      this.logger.verbose(`Routing by input node type: ${job.nodeType}`);
      if (job.nodeType === NodeType.AssetsNodeComponent) {
        console.log('Processing AssetsNodeComponent (Input-based)');
      }
      return inputProcessor.processJob(job, task, flow);
    }

    this.logger.error(`No processor found for Process: ${job.processNodeType} or Input: ${job.nodeType}`);
    throw new Error(`No processor found for node type: ${job.processNodeType}`);
  }

  async processJobCompletion(job: IJobExecutionState, task: ITaskExecutionState, flow: ICreativeFlowBoard): Promise<Partial<IExecutionResult>> {
    this.logger.verbose(`Processing job completion for task ${task.entityId}`);
    return this.completionNodeProcessor.processJob(job, task, flow);
  }
}
