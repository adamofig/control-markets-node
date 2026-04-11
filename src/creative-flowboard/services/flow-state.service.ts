import { Injectable, Logger } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { FlowNodeSearchesService } from './flow-searches.service';
import {
  ICreativeFlowBoard,
  IFlowExecutionState,
  IJobExecutionState,
  IFlowNode,
  ITaskExecutionState,
  NodeType,
  StatusJob,
  ProcessNodeType,
} from '../models/creative-flowboard.models';

@Injectable()
export class FlowStateService {
  constructor(private agentFlowUtilsService: FlowNodeSearchesService) {}

  private logger = new Logger(FlowStateService.name);

  public createInitialState(flow: ICreativeFlowBoard, nodeId?: string): IFlowExecutionState {
    const id = new ObjectId().toHexString();
    this.logger.log(`Creating initial state for flow ${flow.id}`);

    const newFlowState: IFlowExecutionState = { id: id, flowExecutionId: id, flowId: flow.id.toString(), status: StatusJob.PENDING, tasks: [] };

    let processNodes = flow.nodes.filter(node => node.config.category === 'process');
    if (nodeId) {
      processNodes = processNodes.filter(node => node.id === nodeId);
    }
    newFlowState.tasks = this._convertProcessNodesToExecutionTask(processNodes, newFlowState.flowExecutionId);

    this._assignJobsToTasks(flow, processNodes, newFlowState);
    return newFlowState;
  }

  private _assignJobsToTasks(flow: ICreativeFlowBoard, processNodes: IFlowNode[], executionFlowState: IFlowExecutionState): void {
    for (const processNode of processNodes) {
      const executionTask = executionFlowState.tasks.find(t => t.processNodeId === processNode.id);
      if (!executionTask) continue;

      const inputNodes = this.agentFlowUtilsService.getInputNodes(processNode.id, flow);
      // CompletionNodeComponent and OutcomeNodeComponent are nodes valid to create a job.
      const inputTaskableNodes = inputNodes.filter(node => node.config.category === 'input' || node.config.component === NodeType.AssetGeneratedNodeComponent);
      // SourcesNodeComponent adds information to the flow but doesn't create a job.
      const inputValidJobsNodes = inputTaskableNodes.filter(node => node.config.component !== NodeType.SourcesNodeComponent);

      if (processNode.config.component === ProcessNodeType.VideoGenNodeComponent) {
        executionTask.jobs = this._createVideoGenJob(inputValidJobsNodes, processNode, executionTask, executionFlowState);
        continue;
      }

      if (processNode.config.component === ProcessNodeType.NanoBananaNodeComponent) {
        executionTask.jobs = this._createNanoBananaJob(inputValidJobsNodes, processNode, executionTask, executionFlowState);
        continue;
      }

      if (inputNodes.length === 0) {
        if (processNode.config.component === NodeType.TaskNodeComponent) {
          // TaskNodeComponent can run with no input nodes — use the process node itself as the job source.
          executionTask.jobs = this._createJobStates(flow, [processNode], executionTask.id, executionFlowState.flowExecutionId, processNode.id, processNode.config.component);
        } else {
          this.logger.warn(`Task ${processNode.config.component} ${processNode.id} has no input nodes, need at least one to create a job. Skipping...`);
        }
        continue;
      }

      executionTask.jobs = this._createJobStates(flow, inputValidJobsNodes, executionTask.id, executionFlowState.flowExecutionId, processNode.id, processNode.config.component);
    }
  }

  private _createVideoGenJob(inputNodes: IFlowNode[], processNode: IFlowNode, executionTask: ITaskExecutionState, executionFlowState: IFlowExecutionState): IJobExecutionState[] {
    if (inputNodes.length === 0) {
      this.logger.warn(`VideoGen node ${processNode.id} has no input nodes. Skipping...`);
      return [];
    }
    return [
      {
        inputNodeId: inputNodes[0].id,
        inputNodeIds: inputNodes.map(n => n.id),
        processNodeId: processNode.id,
        outputNodeId: null,
        nodeType: inputNodes[0].config.component,
        processNodeType: processNode.config.component,
        inputEntityId: inputNodes[0].data?.nodeData?.id || inputNodes[0].data?.nodeData?._id || null,
        status: StatusJob.PENDING,
        statusDescription: '',
        messages: [],
        outputEntityId: null,
        resultType: '',
        fatherTaskId: executionTask.id,
        flowExecutionId: executionFlowState.flowExecutionId,
      },
    ];
  }

  private _createNanoBananaJob(inputNodes: IFlowNode[], processNode: IFlowNode, executionTask: ITaskExecutionState, executionFlowState: IFlowExecutionState): IJobExecutionState[] {
    // NanoBanana can generate from prompt alone — input nodes are optional.
    const firstNode = inputNodes[0] ?? null;
    return [
      {
        inputNodeId: firstNode?.id ?? null,
        inputNodeIds: inputNodes.map(n => n.id),
        processNodeId: processNode.id,
        outputNodeId: null,
        nodeType: firstNode?.config.component ?? processNode.config.component,
        processNodeType: processNode.config.component,
        inputEntityId: firstNode?.data?.nodeData?.id || firstNode?.data?.nodeData?._id || null,
        status: StatusJob.PENDING,
        statusDescription: '',
        messages: [],
        outputEntityId: null,
        resultType: '',
        fatherTaskId: executionTask.id,
        flowExecutionId: executionFlowState.flowExecutionId,
      },
    ];
  }

  private _createJobStates(
    flow: ICreativeFlowBoard,
    inputNodes: IFlowNode[],
    taskExecutionId: string,
    flowExecutionId: string,
    processNodeId: string,
    processNodeType: NodeType
  ): IJobExecutionState[] {
    return inputNodes.map(inputNode => {
      // Buscar si existe un outputNode: el el flow un node que tenga como input el inputNode.

      const outputNode = flow.nodes.find(node => node.data?.inputNodeId === inputNode.id && node.data?.processNodeId === processNodeId);
      const entityId = inputNode.data?.nodeData?.id || inputNode.data?.nodeData?._id || null;
      return {
        inputEntityId: entityId,
        nodeType: inputNode.config.component,
        processNodeType: processNodeType,
        inputNodeId: inputNode.id,
        processNodeId: processNodeId,
        outputNodeId: outputNode?.id || null,
        status: StatusJob.PENDING,
        statusDescription: '',
        messages: [],
        outputEntityId: null,
        resultType: '',
        fatherTaskId: taskExecutionId,
        flowExecutionId: flowExecutionId,
      };
    });
  }

  private _convertProcessNodesToExecutionTask(processNodes: IFlowNode[], flowExecutionId: string): ITaskExecutionState[] {
    return processNodes.map(processNode => {
      const entityId = processNode.data?.nodeData?.id || processNode.data?.nodeData?._id || null;
      const taskId = new ObjectId().toHexString();
      return {
        id: `task-execution-${taskId}`,
        flowExecutionId: flowExecutionId,
        processNodeId: processNode.id,
        entityId: entityId || null,
        nodeType: processNode.config.component,
        status: StatusJob.PENDING,
        jobs: [],
      };
    });
  }
}
