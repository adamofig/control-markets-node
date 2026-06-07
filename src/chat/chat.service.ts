import { Injectable } from '@nestjs/common';
import { streamText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { AppToken } from '@dataclouder/nest-auth';
import { AgentCardService, IAgentCard } from '@dataclouder/nest-agent-cards';
import { BlogEntryService } from '../blog-entry/services/blog-entry.service';
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
    private readonly agentCardService: AgentCardService,
    private readonly blogEntryService: BlogEntryService,
  ) {}

  async streamChat(
    messages: { role: 'user' | 'assistant'; content: string }[],
    token: AppToken,
    orgId?: string,
    agentCardId?: string,
  ): Promise<AsyncIterable<string>> {
    const resolvedOrgId = orgId ?? token['orgId'];

    let agentCard: IAgentCard | null = null;
    if (agentCardId) {
      try {
        agentCard = await this.agentCardService.findById(agentCardId);
      } catch (err) {
        console.error(`Error fetching agent card ${agentCardId}:`, err);
      }
    }

    const system = this.buildSystemPrompt(token, resolvedOrgId, agentCard);
    const toolsEnabled = !agentCard || agentCard.agenticConfig?.enabled;
    const modelToUse = agentCard?.agenticConfig?.reasoningModel?.modelName || 'gemini-3.1-flash-lite-preview';

    const tools: any = {};
    if (toolsEnabled) {
      tools.getOrgMembers = tool({
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
      });

      tools.createTask = tool({
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
      });

      tools.moveNodes = tool({
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
      });

      tools.createBlogPost = tool({
        description:
          'Crea un borrador de post de blog en formato Markdown en el sistema de archivos local y opcionalmente lo sube/publica a GitHub. Utiliza esto cuando el usuario pida redactar, crear, escribir o publicar una entrada de blog.',
        inputSchema: z.object({
          title: z.string().describe('Título del artículo del blog (ej: "Mi Post sobre Inteligencia Artificial").'),
          content: z.string().describe('Contenido completo del post en formato Markdown.'),
          description: z.string().describe('Una descripción muy breve (máximo 25 palabras) para los metadatos.'),
          tags: z.array(z.string()).optional().describe('Lista de etiquetas del artículo.'),
          category: z.string().optional().describe('Categoría del artículo (por defecto: "Tecnología").'),
          draft: z.boolean().optional().describe('Indica si es un borrador (por defecto: true).'),
          publishToGithub: z.boolean().optional().describe('Si es true, sube/publica automáticamente a GitHub.'),
        }),
        execute: async ({ title, content, description, tags, category, draft, publishToGithub }) => {
          const blogEntry = await this.blogEntryService.save({
            name: title,
            description,
            content,
            tags: tags ?? [],
            category: category ?? 'General',
            draft: draft ?? true,
            orgId: resolvedOrgId,
          });

          const filePath = await this.blogEntryService.writePostToFile(blogEntry);

          let githubResult = null;
          if (publishToGithub) {
            try {
              githubResult = await this.blogEntryService.pushPostToGithub(blogEntry.id || (blogEntry as any)._id);
            } catch (err) {
              githubResult = { success: false, error: err.message };
            }
          }

          return {
            success: true,
            id: blogEntry.id || (blogEntry as any)._id,
            slug: blogEntry.slug,
            filePath,
            github: githubResult,
          };
        },
      });
    }

    const result = streamText({
      model: this.google(modelToUse),
      system,
      messages,
      stopWhen: stepCountIs(5),
      tools,
    });

    return result.textStream;
  }

  private buildSystemPrompt(token: AppToken, orgId?: string, agentCard?: IAgentCard): string {
    let system = `You are an AI assistant embedded in Control Markets, a visual orchestrator for agentic marketing and content workflows.`;

    if (agentCard) {
      const charName = agentCard.characterCard?.data?.name || agentCard.name || 'an AI assistant';
      const personality = agentCard.characterCard?.data?.persona?.personality || '';
      const instructions = agentCard.characterCard?.data?.instructions || '';

      system = `You are ${charName}, an expert agent in Control Markets.
Always stay in character. Speak and behave according to your personality and guidelines.

Your Personality:
${personality}

Your Instructions and Guidelines:
${instructions}
`;
    }

    system += `

Current user context:
- User ID: ${token.userId}
- Email: ${token.email}
- Display name: ${token.name ?? 'unknown'}
- Organization ID: ${orgId ?? 'unknown'}
- Plan: ${token.plan?.type ?? 'basic'}
`;

    const toolsEnabled = !agentCard || agentCard.agenticConfig?.enabled;
    if (toolsEnabled) {
      system += `
You have tools available to take real actions in the platform:
- getOrgMembers: get all members of the organization (returns guests with userId and email)
- createTask: create a new task and assign it to a user or leave it unassigned
- moveNodes: rearrange nodes on a flowboard canvas
- createBlogPost: create a new blog post entry locally and optionally push it to GitHub

Use tools proactively and autonomously. When the user asks to assign a task to someone by name, first call getOrgMembers to get the full member list, find the matching guest by name or email, then call createTask with their userId and email. If the user asks to write, create or publish a blog post, use createBlogPost. Do not ask the user for confirmation or IDs — perform the action and inform the user of the result.`;
    } else {
      system += `
Note: You do not have active execution tools enabled for this conversation. Respond to the user using your persona's knowledge and roleplay.`;
    }

    return system;
  }
}
