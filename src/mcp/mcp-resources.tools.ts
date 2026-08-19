import { Injectable, Logger } from '@nestjs/common';
import { Tool, ToolScopes } from '@rekog/mcp-nest';
import { z } from 'zod';
import { AgenticProfileService } from '../agentic-profile/services/agentic-profile.service';
import { CmResourceResolver } from '../cm-resources/cm-resource.resolver';
import { requireMcpContext } from './mcp-scope.util';
import { MCP_SCOPES } from './mcp-scopes';

/**
 * MCP tools that read *resources* — profiles, and eventually the whole `cm://` address space.
 *
 * Split out of `McpTasksTools`, where a profile-context reader had been living inside the tasks
 * class. Task 25 adds `cm_read` here, next to its neighbours, instead of growing a second domain
 * inside the tasks file.
 *
 * Since task 6 this file also carries `cm_read`, the `cm://` verb: `/mcp` now resolves a real
 * identity per request, so the resolver's mandatory `orgId` has something true to enforce. It is the
 * fourth door of the address space, and it validates in exactly the same place as the other three.
 */
@Injectable()
export class McpResourcesTools {
  private readonly logger = new Logger('McpResourcesTools');

  constructor(
    private readonly agenticProfileService: AgenticProfileService,
    private readonly cmResources: CmResourceResolver,
  ) {}

  @ToolScopes([MCP_SCOPES.resources])
  @Tool({
    name: 'agentic_profile_get_context',
    description: `Retrieves the full compiled Markdown context of an agentic profile (character instructions, knowledge sources, rules/skills, and active tasks) in a single unified Markdown text.
Either profileId or agentName must be provided. Use this to prepare your conversation with all the files and personality details of the agent.
Equivalent to the address \`cm://profile/<id>/context\` served by \`GET /api/cm/resource\` and by \`cm read\`.
The organization is resolved from your token; there is no orgId parameter and none is accepted.`,
    parameters: z.object({
      profileId: z.string().optional().describe('The MongoDB ID of the Agentic Profile.'),
      agentName: z.string().optional().describe('The name of the agent (e.g. "Borges", "Entei") to search for in MongoDB if profileId is not known.'),
    }),
  })
  async getAgenticProfileContext({ profileId, agentName }: { profileId?: string; agentName?: string }, _context: unknown, request: any) {
    const identity = requireMcpContext(request);
    let resolvedId = profileId;

    if (!resolvedId && agentName) {
      const profiles = await this.agenticProfileService.executeOperation({
        action: 'find',
        query: {
          $or: [{ name: new RegExp('^' + agentName + '$', 'i') }, { 'agentCard.name': new RegExp('^' + agentName + '$', 'i') }],
          orgId: identity.orgId,
        },
        options: { limit: 1 },
      });

      if (profiles && Array.isArray(profiles) && profiles.length > 0) {
        resolvedId = profiles[0].id || profiles[0]._id?.toString();
      } else {
        return { content: [{ type: 'text', text: `Error: Could not find any agentic profile named "${agentName}" in your organization` }] };
      }
    }

    if (!resolvedId) {
      return { content: [{ type: 'text', text: 'Error: Must provide either profileId or agentName.' }] };
    }

    try {
      // Through the resolver rather than `composeFullContext` directly, so this tool validates the
      // organization in the same place the other three doors do. It also fixes the original defect:
      // `resolvedOrgId` used to be assigned only in the `agentName` branch, so a direct `profileId`
      // compiled the context of *any* organization's profile with the filter silently dropped.
      const resource = await this.cmResources.read(`cm://profile/${resolvedId}/context`, { orgId: identity.orgId });
      return { content: [{ type: 'text', text: resource.content }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error composing profile context: ${err.message}` }] };
    }
  }

  @ToolScopes([MCP_SCOPES.resources])
  @Tool({
    name: 'cm_read',
    description: `Read any Control Markets document by its cm:// address. Single verb — prefer it over any other way of pulling content.
  cm://skill/<bundle>                          the skill plus the index of its atomic capabilities
  cm://skill/<bundle>:<capability>             ONE capability — prefer this, it returns only what that operation needs
  cm://skill/<bundle>:<capability>/<file.md>   a single embedded document of the skill
  cm://source/<id>                             a knowledge document, memory or exploration
  cm://task/<id>                               a task with its subtask checklist
  cm://profile/<id>/context                    the compiled context of another agent
Executable scripts never come back as content: their workspace paths arrive under \`scripts\`.
A response with \`truncated: true\` was cut at the size cap — ask for something narrower, do not guess the rest.
The organization is resolved from your token; there is no orgId parameter and none is accepted.`,
    parameters: z.object({
      uri: z.string().describe('The cm:// address, exactly as printed in an agent context index.'),
      profileId: z.string().optional().describe('Optional: resolve a source through this profile first, for profile-linked documents.'),
    }),
  })
  async cmRead({ uri, profileId }: { uri: string; profileId?: string }, _context: unknown, request: any) {
    const identity = requireMcpContext(request);
    const resource = await this.cmResources.read(uri, { orgId: identity.orgId, profileId });
    return { content: [{ type: 'text', text: JSON.stringify(resource) }] };
  }
}
