import { Injectable } from '@nestjs/common';
import { IAgentCard, AgentCardService } from '@dataclouder/nest-agent-cards';

import {   AiServicesSdkClient, MessageLLM } from '@dataclouder/nest-ai-services-sdk';


import { AgentOutcomeJobService } from 'src/agent-tasks/services/agent-job.service';
import { AgentTaskType, IAgentOutcomeJob, ILlmTask } from 'src/agent-tasks/models/classes';
import { ICreativeFlowBoard, IExecutionResult, IJobExecutionState, ITaskExecutionState, NodeType, ResponseFormat, StatusJob } from 'src/creative-flowboard/models/creative-flowboard.models';
import { PromptBuilderService } from '../prompt-builder.service';
import { INodeProcessor } from './inode.processor';
import { AgentTasksService } from 'src/agent-tasks/services/agent-tasks.service';
import { Logger } from '@nestjs/common';
import { FlowNodeSearchesService } from '../flow-searches.service';

@Injectable()
export class CompletionNodeProcessor implements INodeProcessor {
  private logger = new Logger(CompletionNodeProcessor.name);
  constructor(
    private agentCardService: AgentCardService,
    private agentTaskService: AgentTasksService,
    private aiServicesClient: AiServicesSdkClient,
    private agentJobService: AgentOutcomeJobService,
    private promptBuilderService: PromptBuilderService,
    private flowSearches: FlowNodeSearchesService
  ) {}

  async processJob(job: IJobExecutionState, task: ITaskExecutionState, flow: ICreativeFlowBoard): Promise<Partial<IExecutionResult>> {
    this.logger.verbose(`Processing job type 🫆AgentNodeProcessor🫆 ${job.nodeType} for task ${task.entityId}`);

    const agentTask: ILlmTask = await this.agentTaskService.findOne(task.entityId);
    let agentCard: IAgentCard = null;

    if (job.nodeType === NodeType.AgentNodeComponent && job.inputEntityId) {
      agentCard = await this.agentCardService.findById(job.inputEntityId);
    }

    const sourcesNodes = this.flowSearches.findProcessSources(flow, job.processNodeId) || [];

    console.log(sourcesNodes);
    // Extract sources if any.

    const chatMessagesRequest = await this.promptBuilderService.build(agentTask, agentCard, sourcesNodes, job.nodeType);

    let result: any;
    let response: any;
    if (agentTask.taskType === AgentTaskType.CREATE_CONTENT) {
      try {
        result = await this.aiServicesClient.llm.chat({
          messages: chatMessagesRequest as MessageLLM[],
          model: agentTask.model,
          returnJson: true,
        });

        // result = await this.chatLLMAdapterService.chatAndExtractJson({
        //   messages: chatMessagesRequest,
        //   model: agentCard.conversationSettings.model,
        // });
      } catch (error) {
        console.log(error);

        return {
          statusDescription: `Probablemente no pudo generar el contenido JSON, intenta con otro modelo: ${error.message}`,
          status: StatusJob.FAILED,
          outputEntityId: null,
          resultType: 'outcome',
        };
      }
      this.logger.verbose(`Response: Getting Response from llm`, result);
    } else {
      try {
        response = await this.aiServicesClient.llm.chat({ messages: chatMessagesRequest as MessageLLM[], model: agentTask.model });
      } catch (error) {
        console.log(error.message);

        return {
          statusDescription: `Probablemente no pudo generar el contenido JSON, intenta con otro modelo: ${error.message}`,
          status: StatusJob.FAILED,
          outputEntityId: null,
          resultType: 'outcome',
        };
      }
      this.logger.verbose(`Response: Getting Response from llm`);
    }
    console.log(result);

    const outcomeJob: IAgentOutcomeJob = {
      task: agentTask,
      agentCard: agentCard,
      response: response,
      messages: chatMessagesRequest as MessageLLM[],
      result: result?.json,
      responseFormat: ResponseFormat.DEFAULT_CONTENT,
      inputNodeId: job.inputNodeId,
    };

    const jobCreated = await this.agentJobService.create(outcomeJob);

    return {
      status: StatusJob.COMPLETED,
      outputEntityId: jobCreated.id,
      resultType: 'outcome',
    };
  }
}
