import { Injectable } from '@nestjs/common';
import { streamText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { AppToken } from '@dataclouder/nest-auth';
import { CreativeFlowboardService } from '../creative-flowboard/services/creative-flowboard.service';
import { AgentTasksService } from '../agent-tasks/services/agent-tasks.service';
import { AssignedType } from '../agent-tasks/models/classes';
import { OrganizationService } from '../organization/services/organization.service';

@Injectable()
export class ChatService {
  private google = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  constructor(
    private readonly organizationService: OrganizationService,
    private readonly flowboardService: CreativeFlowboardService,
    private readonly agentTasksService: AgentTasksService,
  ) {}

  async streamChat(
    messages: { role: 'user' | 'assistant'; content: string }[],
    token: AppToken,
    orgId?: string,
  ): Promise<AsyncIterable<string>> {
    const resolvedOrgId = orgId ?? token['orgId'];
    const system = this.buildSystemPrompt(token, resolvedOrgId);

    const result = streamText({
      model: this.google('gemini-3.1-flash-lite-preview'),
      system,
      messages,
      stopWhen: stepCountIs(5),
      tools: {
        getOrgMembers: tool({
          description:
            'Get all members of the current organization. Returns a list of guests with userId and email. Call this first when the user mentions a person by name to resolve who to assign a task to.',
          inputSchema: z.object({
            orgId: z.string().describe('The organization ID.'),
          }),
          execute: async ({ orgId }) => {
            const org = await this.organizationService.executeOperation({
              action: 'findOne',
              query: { _id: orgId },
              projection: { name: 1, guests: 1 },
            });
            return (org as any)?.guests ?? [];
          },
        }),

        createTask: tool({
          description:
            'Create a new task in the organization and optionally assign it to a user. Use this when the user asks to create or add a task. Requires knowing the assignee userId first — call getOrganizationUsers if the user mentioned a person by name.',
          inputSchema: z.object({
            orgId: z.string().describe('The organization ID.'),
            name: z.string().describe('Task title/name.'),
            description: z.string().optional().describe('Task description or details.'),
            assignedUserId: z.string().optional().describe('userId of the person to assign the task to.'),
            assignedUserName: z.string().optional().describe('Name of the assignee (for display).'),
            assignedUserEmail: z.string().optional().describe('Email of the assignee.'),
          }),
          execute: async ({ orgId, name, description, assignedUserId, assignedUserName, assignedUserEmail }) => {
            const task: any = {
              orgId,
              name,
              description,
            };
            if (assignedUserId) {
              task.assignedType = AssignedType.USER;
              task.assignedTo = { userId: assignedUserId, name: assignedUserName ?? '', email: assignedUserEmail ?? '' };
            }
            const created = await this.agentTasksService.save(task);
            return { success: true, taskId: (created as any).id || (created as any)._id, name, assignedTo: task.assignedTo ?? null };
          },
        }),

        moveNodes: tool({
          description:
            'Move one or more nodes on a flowboard canvas to new (x, y) positions. Use when the user asks to rearrange, move, or reposition nodes on a flow.',
          inputSchema: z.object({
            flowId: z.string().describe('The ID of the flowboard to update.'),
            positions: z
              .array(
                z.object({
                  nodeId: z.string().describe('The ID of the node to move.'),
                  x: z.number().describe('New X coordinate on the canvas.'),
                  y: z.number().describe('New Y coordinate on the canvas.'),
                }),
              )
              .describe('List of nodes and their new positions.'),
          }),
          execute: async ({ flowId, positions }) => {
            const result = await this.flowboardService.moveNodes(flowId, positions);
            return {
              success: true,
              flowId,
              updatedNodes: positions.map(p => p.nodeId),
              totalNodes: result.nodes.length,
            };
          },
        }),
      },
    });

    return result.textStream;
  }

  private buildSystemPrompt(token: AppToken, orgId?: string): string {
    return `You are an AI assistant embedded in Control Markets, a visual orchestrator for agentic marketing and content workflows.

Current user context:
- User ID: ${token.userId}
- Email: ${token.email}
- Display name: ${token.name ?? 'unknown'}
- Organization ID: ${orgId ?? 'unknown'}
- Plan: ${token.plan?.type ?? 'basic'}

You have tools available to take real actions in the platform:
- getOrgMembers: get all members of the organization (returns guests with userId and email)
- createTask: create a new task and assign it to a user or leave it unassigned
- moveNodes: rearrange nodes on a flowboard canvas

Use tools proactively and autonomously. When the user asks to assign a task to someone by name, first call getOrgMembers to get the full member list, find the matching guest by name or email, then call createTask with their userId and email. Do not ask the user for IDs — look them up yourself.`;
  }
}
