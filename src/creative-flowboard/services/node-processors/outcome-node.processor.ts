import { Injectable } from '@nestjs/common';
import { LLMAdapterService, GeminiModels, AiServicesClient, ChatLLMRequestAdapter } from '@dataclouder/nest-vertex';
import { AgentOutcomeJobService } from 'src/agent-tasks/services/agent-job.service';
import { IAgentOutcomeJob, ILlmTask } from 'src/agent-tasks/models/classes';
import { ICreativeFlowBoard, IExecutionResult, IJobExecutionState, ITaskExecutionState, StatusJob } from 'src/creative-flowboard/models/creative-flowboard.models';
import { PromptBuilderService } from '../prompt-builder.service';
import { INodeProcessor } from './inode.processor';
import { FlowNodeSearchesService } from '../flow-searches.service';
import { AgentTasksService } from 'src/agent-tasks/services/agent-tasks.service';
import { ResponseFormat } from 'src/creative-flowboard/models/creative-flowboard.models';
import { Logger } from '@nestjs/common';

@Injectable()
export class OutcomeNodeProcessor implements INodeProcessor {
  private logger = new Logger(OutcomeNodeProcessor.name);
  constructor(
    private agentTaskService: AgentTasksService,
    private chatLLMAdapterService: LLMAdapterService,
    private aiServicesClient: AiServicesClient,
    private agentJobService: AgentOutcomeJobService,
    private promptBuilderService: PromptBuilderService,
    private flowSearches: FlowNodeSearchesService
  ) {}

  async processJob(job: IJobExecutionState, task: ITaskExecutionState, flow: ICreativeFlowBoard): Promise<Partial<IExecutionResult>> {
    this.logger.verbose(`Processing job type 🫆AgentNodeProcessor🫆 ${job.nodeType} for task ${task.entityId}`);

    const agentTask: ILlmTask = await this.agentTaskService.findOne(task.entityId);
    const outcomeNode = this.flowSearches.getNodeById(job.inputNodeId, flow);

    const chatMessagesRequest = await this.promptBuilderService.build(agentTask, outcomeNode.data.nodeData, [], job.nodeType);

    let response: any;
    try {
      response = await this.aiServicesClient.llm.chat({
        messages: chatMessagesRequest as any,
        model: { id: 'Gemini-2.5-flash', modelName: GeminiModels.Gemini2_5Flash, provider: 'google' },
        returnJson: true,
      });
    } catch (error) {
      this.logger.error(`Error in OutcomeNodeProcessor: ${error.message}`);
      return {
        status: StatusJob.FAILED,
        statusDescription: `Error calling LLM: ${error.message}`,
        resultType: 'outcome',
      };
    }

    const outcomeJob: IAgentOutcomeJob = {
      task: agentTask,
      agentCard: null,
      messages: chatMessagesRequest as any,
      result: response.json,
      responseFormat: ResponseFormat.ARRAY,
      inputNodeId: outcomeNode.id,
    };

    const jobCreated = await this.agentJobService.create(outcomeJob);

    return {
      status: StatusJob.COMPLETED,
      outputEntityId: jobCreated.id,
      resultType: 'outcome',
    };
  }
}
