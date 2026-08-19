import { Injectable, Logger } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { AgenticProfileService } from '../agentic-profile/services/agentic-profile.service';

/**
 * MCP tools that read *resources* — profiles, and eventually the whole `cm://` address space.
 *
 * Split out of `McpTasksTools`, where a profile-context reader had been living inside the tasks
 * class. Task 25 adds `cm_read` here, next to its neighbours, instead of growing a second domain
 * inside the tasks file.
 *
 * ---
 *
 * **Why `cm_read` is NOT here yet, and what has to happen first.**
 *
 * `/mcp` has no per-request identity. `McpApiKeyGuard` checks one shared `MCP_API_KEY`, so every
 * tool in this server takes its `orgId` as an argument from the model — which means the door is
 * effectively a platform credential, not a tenant one. Registering the `cm://` verb here today
 * would add a fourth door to a resolver whose entire premise is a single enforced organization
 * check, and hand it no organization to enforce.
 *
 * The fix is task 6 (`ProjectAuthGuard` on `/mcp`, dynamic scoping from the PAT's `orgId`), which
 * task 25 depends on. Until then this file has three tools' worth of REST/tool coverage behind it
 * and the fourth door stays deliberately shut.
 */
@Injectable()
export class McpResourcesTools {
  private readonly logger = new Logger('McpResourcesTools');

  constructor(private readonly agenticProfileService: AgenticProfileService) {}

  @Tool({
    name: 'agentic_profile_get_context',
    description: `Retrieves the full compiled Markdown context of an agentic profile (character instructions, knowledge sources, rules/skills, and active tasks) in a single unified Markdown text.
Either profileId or agentName must be provided. Use this to prepare your conversation with all the files and personality details of the agent.
Equivalent to the address \`cm://profile/<id>/context\` served by \`GET /api/cm/resource\` and by \`cm read\`.`,
    parameters: z.object({
      profileId: z.string().optional().describe('The MongoDB ID of the Agentic Profile.'),
      agentName: z.string().optional().describe('The name of the agent (e.g. "Borges", "Entei") to search for in MongoDB if profileId is not known.'),
      orgId: z.string().optional().describe('Restrict the lookup to one organization. Recommended: without it the read is not tenant-scoped.'),
    }),
  })
  async getAgenticProfileContext({ profileId, agentName, orgId }: { profileId?: string; agentName?: string; orgId?: string }) {
    let resolvedId = profileId;
    let resolvedOrgId: string | undefined = orgId;

    if (!resolvedId && agentName) {
      const profiles = await this.agenticProfileService.executeOperation({
        action: 'find',
        query: {
          $or: [{ name: new RegExp('^' + agentName + '$', 'i') }, { 'agentCard.name': new RegExp('^' + agentName + '$', 'i') }],
          ...(orgId ? { orgId } : {}),
        },
        options: { limit: 1 },
      });

      if (profiles && Array.isArray(profiles) && profiles.length > 0) {
        resolvedId = profiles[0].id || profiles[0]._id?.toString();
        resolvedOrgId = resolvedOrgId || profiles[0].orgId;
      } else {
        return { content: [{ type: 'text', text: `Error: Could not find any agentic profile for agent name "${agentName}"` }] };
      }
    }

    if (!resolvedId) {
      return { content: [{ type: 'text', text: 'Error: Must provide either profileId or agentName.' }] };
    }

    // Behavior kept identical to the version that lived in `McpTasksTools` — clients in production
    // call this without an organization and must keep working. What changed is that the unscoped
    // read is now *audible*: it leaves a line in the log instead of passing `undefined` in silence,
    // which is how it went unnoticed in the first place.
    if (!resolvedOrgId) {
      this.logger.warn(`[UNSCOPED_MCP_READ] agentic_profile_get_context profileId=${resolvedId} sin orgId — /mcp aún no resuelve organización (tarea 6)`);
    }

    try {
      const fullContext = await this.agenticProfileService.composeFullContext(resolvedId, resolvedOrgId);
      return { content: [{ type: 'text', text: fullContext }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error composing profile context: ${err.message}` }] };
    }
  }
}
