import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { CreativeFlowboardService } from '../creative-flowboard/services/creative-flowboard.service';

@Injectable()
export class McpFlowboardTools {
  constructor(private flowboardService: CreativeFlowboardService) {}

  @Tool({
    name: 'flow_listFlows',
    description: 'List all available flowboards with their IDs and basic metadata.',
    parameters: z.object({}),
  })
  async listFlows() {
    const flows = await this.flowboardService.findAll();
    const summary = flows.map(f => ({ id: (f as any).id, name: (f as any).name, nodesCount: (f as any).nodes?.length ?? 0 }));
    return { content: [{ type: 'text', text: JSON.stringify(summary) }] };
  }

  @Tool({
    name: 'flow_runNode',
    description: 'Execute a single node within a flowboard. Returns the initial IFlowExecutionState (async — node runs in background).',
    parameters: z.object({
      flowId: z.string().describe('The ID of the flowboard.'),
      nodeId: z.string().describe('The ID of the node to execute.'),
    }),
  })
  async runNode({ flowId, nodeId }: { flowId: string; nodeId: string }) {
    const result = await this.flowboardService.runNodev2(flowId, nodeId);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @Tool({
    name: 'flow_runAndWait',
    description: 'Execute a single node and wait for the result. Returns the completed AgentOutcomeJob with the AI-generated content.',
    parameters: z.object({
      flowId: z.string().describe('The ID of the flowboard.'),
      nodeId: z.string().describe('The ID of the node to execute.'),
    }),
  })
  async runAndWait({ flowId, nodeId }: { flowId: string; nodeId: string }) {
    const result = await this.flowboardService.runAndWait(flowId, nodeId);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @Tool({
    name: 'flow_moveNodes',
    description: 'Move one or more nodes on a flowboard canvas to new (x, y) positions.',
    parameters: z.object({
      flowId: z.string().describe('The ID of the flowboard.'),
      positions: z.array(
        z.object({
          nodeId: z.string(),
          x: z.number(),
          y: z.number(),
        }),
      ),
    }),
  })
  async moveNodes({ flowId, positions }: { flowId: string; positions: { nodeId: string; x: number; y: number }[] }) {
    await this.flowboardService.moveNodes(flowId, positions);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, flowId, updatedCount: positions.length }) }] };
  }

  @Tool({
    name: 'flow_runFlow',
    description: 'Execute a full flowboard — runs all agent nodes in sequence.',
    parameters: z.object({
      flowId: z.string().describe('The ID of the flowboard to run.'),
    }),
  })
  async runFlow({ flowId }: { flowId: string }) {
    const result = await this.flowboardService.runFlow(flowId);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @Tool({
    name: 'flow_getFlow',
    description: 'Get the full definition of a flowboard including all nodes and edges.',
    parameters: z.object({
      flowId: z.string().describe('The ID of the flowboard.'),
    }),
  })
  async getFlow({ flowId }: { flowId: string }) {
    const result = await this.flowboardService.findOne(flowId);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @Tool({
    name: 'flow_addNodes',
    description: 'Add nodes and edges to an existing flowboard.',
    parameters: z.object({
      flowId: z.string().describe('The target flowboard ID.'),
      nodes: z.array(z.any()).describe('Array of node objects to add.'),
      edges: z.array(z.any()).optional().describe('Array of edge objects to add.'),
    }),
  })
  async addNodes({ flowId, nodes, edges }: { flowId: string; nodes: any[]; edges?: any[] }) {
    const result = await this.flowboardService.addNodes({ flowId, nodes, edges: edges ?? [] });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
}
