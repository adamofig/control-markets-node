import { Injectable, Logger } from '@nestjs/common';
import { streamText, tool, isStepCount } from 'ai';
import { z } from 'zod';
import { AppToken } from '@dataclouder/nest-auth';
import { AgentCardService, IAgentCard } from '@dataclouder/nest-agent-cards';
import { BlogEntryService } from '../blog-entry/services/blog-entry.service';
import { CreativeFlowboardService } from '../creative-flowboard/services/creative-flowboard.service';
import { AgentTasksService } from '../agent-tasks/services/agent-tasks.service';
import { AssignedType } from '../agent-tasks/models/classes';
import { OrganizationService } from '../organization/services/organization.service';
import { KeyBalancerService } from '../key-balancer/key-balancer.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { UiContextSanitizerService } from './context/ui-context-sanitizer.service';
import { UiContextPromptComposerService } from './context/ui-context-prompt-composer.service';
import { UiCapabilityRegistryService } from './context/ui-capability-registry.service';
import { InboxIdentityService } from '../inbox/services/inbox-identity.service';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly organizationService: OrganizationService,
    private readonly flowboardService: CreativeFlowboardService,
    private readonly agentTasksService: AgentTasksService,
    private readonly agentCardService: AgentCardService,
    private readonly blogEntryService: BlogEntryService,
    private readonly keyBalancerService: KeyBalancerService,
    private readonly contextSanitizer: UiContextSanitizerService,
    private readonly contextPromptComposer: UiContextPromptComposerService,
    private readonly capabilityRegistry: UiCapabilityRegistryService,
    private readonly identities: InboxIdentityService,
  ) {}

  async streamChat(
    request: ChatRequestDto,
    token: AppToken,
    resolvedOrgId: string,
  ): Promise<{
    textStream: AsyncIterable<string>;
    contextAck: {
      schemaVersion: 1;
      contextHash: string;
      receivedContextHash?: string;
      redactionCount: number;
      droppedFieldCount: number;
      bytes: number;
      authorizedCapabilities: string[];
    };
  }> {
    const sanitized = this.contextSanitizer.sanitize(request.uiContext);
    const authorizedCapabilities = this.capabilityRegistry.authorize(sanitized.context);

    let agentCard: IAgentCard | null = null;
    if (request.agentCardId) {
      try {
        agentCard = await this.agentCardService.findById(request.agentCardId);
      } catch (err) {
        this.logger.warn(`Unable to load requested agent card ${request.agentCardId}`);
      }
    }

    const toolsEnabled = !agentCard || agentCard.agenticConfig?.enabled;
    const hasStructuredContext = Boolean(sanitized.context);
    const allows = (capability: string) => !hasStructuredContext || authorizedCapabilities.includes(capability);
    const availableToolNames = toolsEnabled
      ? [
          ...(allows('task.create') ? ['getOrgMembers', 'createTask'] : []),
          ...(allows('flow.node.move') ? ['moveNodes'] : []),
          ...(allows('blog.create') ? ['createBlogPost'] : []),
        ]
      : [];
    const system = this.buildSystemPrompt(token, resolvedOrgId, agentCard, availableToolNames)
      + this.contextPromptComposer.compose(sanitized.context, authorizedCapabilities);
    const modelToUse = agentCard?.agenticConfig?.reasoningModel?.modelName || 'gemini-3.5-flash-lite';

    // Obtener el proveedor de Google balanceado (Service Account o API Key) desde KeyBalancer
    const { googleProvider, balancedKey } = await this.keyBalancerService.createGoogleProvider(modelToUse, token);
    const keyName = balancedKey?.name || balancedKey?.id || (balancedKey?.key ? 'balanced-key' : 'env-fallback-key');
    
    this.logger.log(`🔑 ChatStream using key '${keyName}' (type: ${balancedKey?.keyType || 'default'}) for model '${modelToUse}'`);


    const tools: any = {};
    if (toolsEnabled && allows('task.create')) {
      tools.getOrgMembers = tool({
        description:
          'Get all members of the current organization. Returns a list of guests with userId and email. Call this first when the user mentions a person by name to resolve who to assign a task to.',
        inputSchema: z.object({}),
        execute: async () => {
          const org = await this.organizationService.executeOperation({
            action: 'findOne',
            query: { _id: resolvedOrgId },
            projection: { name: 1, guests: 1 },
          });
          return (org as any)?.guests ?? [];
        },
      });

      tools.createTask = tool({
        description:
          'Create a new task in the organization and optionally assign it to a user. Use this when the user asks to create or add a task. Requires knowing the assignee userId first — call getOrgMembers if the user mentioned a person by name.',
        inputSchema: z.object({
          name: z.string().describe('Task title/name.'),
          description: z.string().optional().describe('Task description or details.'),
          assignedUserId: z.string().optional().describe('userId of the person to assign the task to.'),
          assignedUserName: z.string().optional().describe('Name of the assignee (for display).'),
          assignedUserEmail: z.string().optional().describe('Email of the assignee.'),
        }),
        execute: async ({ name, description, assignedUserId, assignedUserName, assignedUserEmail }) => {
          const task: any = {
            orgId: resolvedOrgId,
            name,
            description,
          };
          if (assignedUserId) {
            const member = await this.identities.findOrganizationUser(resolvedOrgId, assignedUserId);
            task.assignedType = AssignedType.USER;
            task.assignedTo = {
              userId: member.refId,
              name: member.displayName || assignedUserName || '',
              email: assignedUserEmail ?? '',
            };
          }
          const created = await this.agentTasksService.save(task);
          return { success: true, taskId: (created as any).id || (created as any)._id, name, assignedTo: task.assignedTo ?? null };
        },
      });
    }

    if (toolsEnabled && allows('flow.node.move')) {
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
          const result = await this.flowboardService.moveNodesForOrganization(flowId, resolvedOrgId, positions);
          return {
            success: true,
            flowId,
            updatedNodes: positions.map(p => p.nodeId),
            totalNodes: result.nodes.length,
          };
        },
      });
    }

    if (toolsEnabled && allows('blog.create')) {
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
      model: googleProvider(modelToUse),
      instructions: system,
      messages: request.messages,
      stopWhen: isStepCount(5),
      tools,
    });

    return {
      textStream: result.textStream,
      contextAck: {
        schemaVersion: 1,
        contextHash: sanitized.context?.contextHash || 'none',
        receivedContextHash: sanitized.receivedContextHash,
        redactionCount: sanitized.redactionCount,
        droppedFieldCount: sanitized.droppedFieldCount,
        bytes: sanitized.bytes,
        authorizedCapabilities,
      },
    };
  }

  private buildSystemPrompt(token: AppToken, orgId: string, agentCard: IAgentCard | null, availableToolNames: string[]): string {
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
- Organization ID: ${orgId ?? 'unknown'} (resolved and validated by the server)
- Plan: ${token.plan?.type ?? 'basic'}
`;

    if (availableToolNames.length) {
      system += `
The server has exposed these tools for this turn: ${availableToolNames.join(', ')}.
Use only exposed tools. Tool inputs are validated again against the canonical organization. Never claim an action succeeded until its tool result confirms it.`;
    } else {
      system += `
No execution tools are authorized for this turn. Explain what the user can do, but do not claim to have changed application data.`;
    }

    return system;
  }
}
