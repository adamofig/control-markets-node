import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { ICanvasFlowDiagram, IExecutionResult, IJobExecutionState, ITaskExecutionState, StatusJob } from 'src/agent-flows/models/agent-flows.models';
import { INodeProcessor } from './inode.processor';

import { Logger } from '@nestjs/common';
import { IAssetNodeData } from 'src/agent-flows/models/nodes.models';
import { GeneratedAssetService, ComfyVideoService, AiServicesClient, GeneratedAsset, IAssetsGeneration } from '@dataclouder/nest-vertex';
import { FlowsDbStateService } from '../flows-db-state.service';

@Injectable()
export class VideoGenNodeProcessor implements INodeProcessor {
  private logger = new Logger(VideoGenNodeProcessor.name);
  constructor(
    private generatedAssetService: GeneratedAssetService,
    private comfyVideoService: ComfyVideoService,
    private clientAIService: AiServicesClient,
    private flowsDbStateService: FlowsDbStateService
  ) {}

  async processJob(job: IJobExecutionState, task: ITaskExecutionState, flow: ICanvasFlowDiagram): Promise<Partial<IExecutionResult>> {
    this.logger.verbose(`Processing job type 🍊 VideoGenNodeProcessor ${job.nodeType} for task ${task.entityId}`);

    const inputNodeAsset = flow.nodes.find(node => node.id === job.inputNodeId);
    const processNodeGen = flow.nodes.find(node => node.id === job.processNodeId);

    if (!inputNodeAsset) {
      throw new Error(`Node ${job.inputNodeId} not found`);
    }

    const assetNodeData = inputNodeAsset?.data.nodeData as IAssetNodeData;
    const processNodeData = processNodeGen?.data.nodeData;

    const newAsset: Partial<GeneratedAsset> = {
      assets: { firstFrame: assetNodeData.storage } as IAssetsGeneration,
      prompt: processNodeData?.prompt,
      description: processNodeData?.description,
      request: processNodeData?.request,
      provider: processNodeData.provider,
    };

    const newGeneratedAsset = await this.generatedAssetService.save(newAsset);

    try {
      this.logger.log(`Calling AI Service: Generating video for asset ${newGeneratedAsset.id} using provider ${processNodeData.provider}...`);
      await this.clientAIService.video.generateFromAssetId(newGeneratedAsset.id);

      this.logger.log(`DONE Video generated for asset ${newGeneratedAsset.id}`);

      await this._findJobStateAndComplete({ flowExecutionId: job.flowExecutionId, fatherTaskId: task.id, inputNodeId: job.inputNodeId, outcomeId: newGeneratedAsset.id, status: StatusJob.COMPLETED });

      this.logger.log(`DONE Job ${job.inputNodeId} in task ${task.entityId} updated to ${StatusJob.COMPLETED}`);

      return { status: StatusJob.COMPLETED, outputEntityId: newGeneratedAsset.id, resultType: 'generatedAsset' };
    } catch (error) {
      this.logger.error(`Error generating video for asset ${newGeneratedAsset.id}. Error: ${error?.message}`);

      const errorMsn = error?.message || 'Unknown error';

      await this._findJobStateAndComplete({ flowExecutionId: job.flowExecutionId, fatherTaskId: task.id, inputNodeId: job.inputNodeId, status: StatusJob.FAILED, statusDescription: errorMsn });

      return { status: StatusJob.FAILED, outputEntityId: newGeneratedAsset.id, resultType: 'generatedAsset', statusDescription: errorMsn };
    }
  }

  private async _findJobStateAndComplete(options: { flowExecutionId: string; fatherTaskId: string; inputNodeId: string; outcomeId?: string; status: StatusJob; statusDescription?: string }) {
    const { flowExecutionId, fatherTaskId, inputNodeId, outcomeId, status, statusDescription } = options;
    const executionState = await this.flowsDbStateService.findOne(flowExecutionId);
    if (!executionState) {
      this.logger.error(`Execution state ${flowExecutionId} not found`);
      return { executionState: null, task: null, job: null };
    }

    const task = executionState.tasks.find(t => t.id === fatherTaskId);
    if (!task) {
      this.logger.error(`Task ${fatherTaskId} not found in execution state ${flowExecutionId}`);
      return { executionState, task: null, job: null };
    }

    const job = task.jobs.find(j => j.inputNodeId === inputNodeId);
    if (!job) {
      this.logger.error(`Job with inputNodeId ${inputNodeId} not found in task ${fatherTaskId}`);
      return { executionState, task, job: null };
    }

    job.status = status;
    if (statusDescription) {
      job.statusDescription = statusDescription;
    }

    if (outcomeId) {
      job.outputEntityId = outcomeId;
      job.resultType = 'generatedAsset';
    }

    await this.flowsDbStateService.updateFirestore(flowExecutionId, executionState);
    this.logger.log(`Job ${job.inputNodeId} in task ${task.entityId} updated to ${status}`);

    return { executionState, task, job };
  }

  @OnEvent('asset.updated')
  async handleAssetUpdated(payload: any) {
    this.logger.log('Asset updated event received:', payload);

    const jobFromMetadata = payload.metadata.job;
    if (!jobFromMetadata) {
      this.logger.warn('No job found in metadata');
      return;
    }

    const { flowExecutionId, fatherTaskId, inputNodeId } = jobFromMetadata;

    await this._findJobStateAndComplete({
      flowExecutionId,
      fatherTaskId,
      inputNodeId,
      outcomeId: payload.id,
      status: StatusJob.COMPLETED,
    });
  }
}
