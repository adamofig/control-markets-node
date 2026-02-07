import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FlowBoardEntity, CreativeFlowboardDocument } from '../schemas/creative-flowboard.schema';
import { ICreativeFlowBoard, IExecutionResult, IFlowExecutionState, NodeType } from '../models/creative-flowboard.models';
import { AddNodesDto, WebhookNodeDto } from '../models/creative-flowboard.dto';
import { MongoService } from '@dataclouder/nest-mongo';
import { CloudStorageService } from '@dataclouder/nest-storage';
import { FlowsDbStateService } from './flows-db-state.service';
import { FlowEventsService } from './flow-events.service';

import { FlowRunnerService } from './flow-runner.service';
import { FlowStateService } from './flow-state.service';
import { FlowExecutionStateService } from './flow-execution-state.service';
import { EntityCommunicationService } from '@dataclouder/nest-mongo';
import { AgentOutcomeJobService } from 'src/agent-tasks/services/agent-job.service';
import { FlowNodeSearchesService } from './flow-searches.service';
import { ChatLLMRequestAdapter, EModelQuality, LLMAdapterService, MessageLLM, AiServicesClient } from '@dataclouder/nest-vertex';
import { NodePromptBuilderService, PersonaExtractionLevel } from './flow-node-prompt-builder.service';
import { ChatwootService } from '../integrations/chatwoot.service';
import { AppException } from '@dataclouder/nest-core';
import { AgentCardService, ChatMessage } from '@dataclouder/nest-agent-cards';

@Injectable()
export class CreativeFlowboardService extends EntityCommunicationService<CreativeFlowboardDocument> {
  private logger = new Logger(CreativeFlowboardService.name);
  constructor(
    @InjectModel(FlowBoardEntity.name)
    protected creativeFlowboardModel: Model<CreativeFlowboardDocument>,
    protected mongoService: MongoService,
    protected cloudStorageService: CloudStorageService,
    private flowsDbStateService: FlowsDbStateService,
    private flowRunnerService: FlowRunnerService,
    private flowStateService: FlowStateService,
    private flowExecutionStateService: FlowExecutionStateService,
    private agentJobService: AgentOutcomeJobService,
    private nodeSearchService: FlowNodeSearchesService,
    private chatLLMAdapterService: LLMAdapterService,
    private nodePromptBuilderService: NodePromptBuilderService,
    private chatwootService: ChatwootService,
    private aiServicesClient: AiServicesClient,
    private agentCardService: AgentCardService,
    private readonly flowEventsService: FlowEventsService
  ) {
    super(creativeFlowboardModel, mongoService);
  }

  public async runFlow(id: string): Promise<IFlowExecutionState> {
    const flow: FlowBoardEntity = await this.findOne(id);
    const flowExecutionState: IFlowExecutionState = this.flowStateService.createInitialState(flow);
    await this.flowsDbStateService.createFirebaseLog(flowExecutionState);
    const result = await this.flowExecutionStateService.save(flowExecutionState, flowExecutionState.flowExecutionId);
    delete flowExecutionState['_id'];
    console.log('Revisar que al actualizar tenga el execution state y el flow id. en el process, eso va a ser mi flujo más facil...');
    this.flowRunnerService.initExecution(flow, flowExecutionState);
    return flowExecutionState;
  }

  public async runNodev2(flowId: string, nodeId: string): Promise<IFlowExecutionState> {
    this.logger.verbose(`Running node ${nodeId} for flow ${flowId}`);
    const flow: ICreativeFlowBoard = await this.findOne(flowId);
    const flowExecutionState: IFlowExecutionState = this.flowStateService.createInitialState(flow, nodeId);
    // TODO: check if i can remove this. 
    await this.flowsDbStateService.createFirebaseLog(flowExecutionState);
    const result = await this.flowExecutionStateService.save(flowExecutionState, flowExecutionState.flowExecutionId);
    delete flowExecutionState['_id'];
    this.flowRunnerService.initExecution(flow, flowExecutionState);
    return flowExecutionState;
  }

  public async runAndWait(flowId: string, nodeId: string): Promise<any> {
    this.logger.verbose(`Running node ${nodeId} for flow ${flowId}`);
    const flow: ICreativeFlowBoard = await this.findOne(flowId);
    const flowExecutionState: IFlowExecutionState = this.flowStateService.createInitialState(flow, nodeId);
    await this.flowsDbStateService.createFirebaseLog(flowExecutionState);
    const result = await this.flowExecutionStateService.save(flowExecutionState, flowExecutionState.flowExecutionId);
    delete flowExecutionState['_id'];
    const outcomesExecutions = await this.flowRunnerService.initExecution(flow, flowExecutionState);
    // Debería ser capaz de obtener todos los ids, pero con este basta por ahora.
    const firstOutcomeId = outcomesExecutions[0].outputEntityId;
    console.log('outcomesExecutions', outcomesExecutions);

    const job = await this.agentJobService.agentJobModel.findOne({ id: firstOutcomeId }, { result: 1, response: 1, responseFormat: 1 });

    console.log('Buscando -  Datos del flujo ');
    return job;
  }

  public async runTaskNode(body: WebhookNodeDto) {
    this.logger.verbose(`Running task node ${body.nodeId} for flow ${body.flowId}`);
    // Step One get the Flow
    const flow: ICreativeFlowBoard = await this.findOne(body.flowId);
    // Step 2 get the Task Node.
    const taskNode = flow.nodes.find(node => node.id === body.nodeId);

    const inputNodes = this.nodeSearchService.getInputNodes(body.nodeId, flow);

    const messages: ChatMessage[] = this.nodePromptBuilderService.getContextPrompts(inputNodes);

    const completionNode = this.nodeSearchService.getFirstInputNodeOfType(body.nodeId, flow, NodeType.AgentNodeComponent);

    if (completionNode) {
      const id = completionNode.data?.nodeData?._id || completionNode.data?.nodeData?.id;
      const agentCardEntity = await this.agentCardService.findOne(id);
      const agentCardMessage = this.nodePromptBuilderService.getAgentCardPersonaMessage(agentCardEntity, PersonaExtractionLevel.BASIC);

      if (agentCardMessage) {
        messages.push(agentCardMessage);
      }
    }

    if (body.conversationId) {
      this.logger.verbose(`Running task node ${body.nodeId} for flow ${body.flowId} with conversation ${body.conversationId}`);
      const conversation = await this.chatwootService.getApplicationMessages({
        account_id: body.accountId || '1',
        conversation_id: body.conversationId,
      });
      console.log('conversation', conversation);

      messages.push(...conversation);
    }
    console.log(`Total Messages: ${messages.length} - Last message: ${messages[messages.length - 1].content}`);

    const request: ChatLLMRequestAdapter = {
      messages: messages as MessageLLM[],
      model: { quality: EModelQuality.FAST, provider: 'google' },
    };

    try {
      const response = await this.aiServicesClient.llm.chat(request);
      console.log('response', response);
      return response;
    } catch (error) {
      console.error('Error calling LLM Service: ', error);
      throw new AppException({ error_message: 'Error calling LLM Service: ' + error.message, explanation: error.response.data });
    }
  }
  public async addNodes(body: AddNodesDto) {
    this.logger.verbose(`Adding nodes to flow ${body.flowId}`);
    const { flowId, nodes, edges } = body;

    for (const node of nodes) {
      if (!node.config.component || !Object.values(NodeType).includes(node.config.component)) {
        throw new AppException({ error_message: 'You must add a valid node component', explanation: Object.values(NodeType).join(', ') });
      }
      if (!node.point) {
        node.point = { x: 0, y: 0 };
      }
    }

    const update = {
      $push: {
        nodes: { $each: nodes },
        edges: { $each: edges },
      },
    };

    const result = await this.creativeFlowboardModel.findByIdAndUpdate(flowId, update, { new: true });
    this.flowEventsService.emit(flowId, { event: 'SYNC_CANVAS', payload: result });
    return result;
  }
}
