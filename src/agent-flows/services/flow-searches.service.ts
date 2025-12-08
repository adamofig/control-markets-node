import { Injectable, Logger } from '@nestjs/common';
import { ICanvasFlowDiagram, IFlowEdge, IFlowNode, NodeType } from '../models/agent-flows.models';

@Injectable()
export class FlowNodeSearchesService {
  private logger = new Logger(FlowNodeSearchesService.name);
  constructor() {}

  public getInputs(nodeId: string, edges: IFlowEdge[]): string[] {
    const edgesWhereTargetIsNode = edges.filter(edge => edge.target === nodeId);
    const sourceIds = edgesWhereTargetIsNode.map(edge => edge.source);
    return sourceIds;
  }

  public getInputNodes(nodeId: string, agentFlows: ICanvasFlowDiagram): IFlowNode[] {
    const inputsIds = this.getInputs(nodeId, agentFlows.edges);
    const allNodes = agentFlows.nodes;
    return allNodes.filter(node => inputsIds.includes(node.id));
  }

  public getFirstInputNodeOfType(nodeId: string, agentFlows: ICanvasFlowDiagram, type: NodeType): IFlowNode | undefined {
    const inputNodes = this.getInputNodes(nodeId, agentFlows);
    if (inputNodes.length === 0) {
      return undefined;
    }
    return inputNodes.find(node => node.component === type);
  }

  public getOutputNodes(nodeId: string, agentFlows: ICanvasFlowDiagram): IFlowNode[] {
    const edgesWhereSourceIsNode = agentFlows.edges.filter(edge => edge.source === nodeId);
    const targetIds = edgesWhereSourceIsNode.map(edge => edge.target);
    const allNodes = agentFlows.nodes;
    return allNodes.filter(node => targetIds.includes(node.id));
  }

  public getNodeById(nodeId: string, agentFlows: ICanvasFlowDiagram): IFlowNode {
    return agentFlows.nodes.find(node => node.id === nodeId);
  }

  findProcessSources(flow: ICanvasFlowDiagram, processNodeId: string): IFlowNode[] {
    const processNode = flow.nodes.find(node => node.id === processNodeId);
    console.log(processNode);
    const edgesWhereTargetIsProcess = flow.edges.filter(edge => edge.target === processNodeId);
    const sourceIds = edgesWhereTargetIsProcess.map(edge => edge.source);
    // get nodes in ids
    const nodesConnectedToTask = flow.nodes.filter(node => sourceIds.includes(node.id));

    const sources = nodesConnectedToTask.filter(node => node.type === NodeType.SourcesNodeComponent);
    return sources;
  }
}
