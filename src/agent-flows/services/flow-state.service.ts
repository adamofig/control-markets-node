import { Injectable } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { FlowNodeSearchesService } from './flow-searches.service';
import {
  ICanvasFlowDiagram,
  IFlowExecutionState,
  IJobExecutionState,
  IFlowNode,
  ITaskExecutionState,
  NodeType,
  StatusJob,
} from '../models/agent-flows.models';

@Injectable()
export class FlowStateService {
  constructor(private agentFlowUtilsService: FlowNodeSearchesService) {}

  public createInitialState(flow: ICanvasFlowDiagram, nodeId?: string): IFlowExecutionState {
    const id = new ObjectId().toHexString();
    console.log('id', id);

    const newFlowState: IFlowExecutionState = {
      id: id,
      flowExecutionId: id,
      flowId: flow.id.toString(),
      status: StatusJob.PENDING,
      tasks: [],
    };

    let processNodes = flow.nodes.filter(node => node.category === 'process');
    if (nodeId) {
      processNodes = processNodes.filter(node => node.id === nodeId);
    }
    newFlowState.tasks = this._convertProcessNodesToExecutionTask(processNodes, newFlowState.flowExecutionId);

    this._assignJobsToTasks(flow, processNodes, newFlowState);
    return newFlowState;
  }

  private _assignJobsToTasks(flow: ICanvasFlowDiagram, processNodes: IFlowNode[], executionFlowState: IFlowExecutionState): void {
    for (const processNode of processNodes) {
      const inputNodes = this.agentFlowUtilsService.getInputNodes(processNode.id, flow);
      // AgentNodeComponent and OutcomeNodeComponent are nodes valid to create a job.
      const inputTaskableNodes = inputNodes.filter(node => node.category === 'input'); // Me parece que esta de más todos deberian ser inputs, pero lo voy a dejar por si acaso.
      const inputValidJobsNodes = inputTaskableNodes.filter(node => node.component != NodeType.SourcesNodeComponent);
      // SourcesNodeComponent add information to the flow but don't create a job.
      const executionTask = executionFlowState.tasks.find(t => t.processNodeId === processNode.id);
      if (executionTask) {
        executionTask.jobs = this._createJobStates(
          flow,
          inputValidJobsNodes,
          executionTask.id,
          executionFlowState.flowExecutionId,
          processNode.id
        );
      }
    }
  }

  private _createJobStates(
    flow: ICanvasFlowDiagram,
    inputNodes: IFlowNode[],
    taskExecutionId: string,
    flowExecutionId: string,
    processNodeId: string
  ): IJobExecutionState[] {
    return inputNodes.map(inputNode => {
      // Buscar si existe un outputNode: el el flow un node que tenga como input el inputNode.

      const outputNode = flow.nodes.find(node => node.data?.inputNodeId === inputNode.id && node.data?.processNodeId === processNodeId);
      const entityId = inputNode.data?.nodeData?.id || inputNode.data?.nodeData?._id || null;
      return {
        inputEntityId: entityId,
        nodeType: inputNode.type,
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
        nodeType: processNode.type,
        status: StatusJob.PENDING,
        jobs: [],
      };
    });
  }
}
