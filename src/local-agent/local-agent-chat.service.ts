import { Injectable, Logger } from '@nestjs/common';
import { streamText, isStepCount, tool } from 'ai';
import { z } from 'zod';
import { createGoogle } from '@ai-sdk/google';
import { AppToken } from '@dataclouder/nest-auth';
import { AgenticProfileService } from '../agentic-profile/services/agentic-profile.service';
import { SkillsService } from '../agent-skills/services/skills.service';
import { FilesystemToolsService } from './filesystem-tools.service';
import { normalizeTokenUsage } from './ai-usage.util';
import { AgenticContextLevel, AgenticRuntimeProfile, IAttachedSourceRef } from '../agentic-profile/models/agentic-profile.models';
import { runtimeCacheKey } from '../agentic-profile/services/context-access-hints.util';
import { createInjectedContextSnapshot, InjectedContextSnapshot } from './context-snapshot.util';
import { AttachedSourceReport, formatAttachedSourcesBlock } from './attached-sources.util';
import { KeyBalancerService } from '../key-balancer/key-balancer.service';
import { MentionsService } from '../mentions/mentions.service';

export interface LocalAgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Structured event sent over SSE so the UI can render text and tool activity. */
export type LocalAgentStreamEvent =
  | { type: 'context-snapshot'; context: InjectedContextSnapshot }
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call'; toolName: string; input: unknown }
  | { type: 'tool-result'; toolName: string; output: unknown }
  | { type: 'finish'; usage?: unknown }
  | { type: 'error'; error: string }
  // ACP engine extras (claude / codex / agy):
  // `model`/`reasoningEffort` are what the adapter negotiated for this session, not what the
  // caller requested — they are absent when the engine advertises no such config option.
  | { type: 'session'; sessionId: string; cliSessionId?: string; model?: string; reasoningEffort?: string }
  | { type: 'permission-request'; requestId: string; toolName: string; rationale: string; options: { optionId: string; name: string; kind: string }[] }
  | { type: 'plan'; entries: unknown[] }
  | { type: 'status'; message: string }
  // Reports which `@mention` attachments actually made it into this turn's prompt, with their real
  // size. The UI turns optimistic chips into confirmed ones — or flags what it could not resolve.
  | { type: 'attached-sources'; attached: AttachedSourceReport[] };

const MAX_STEPS = 25;
const CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class LocalAgentChatService {
  private readonly logger = new Logger(LocalAgentChatService.name);
  private contextCache = new Map<string, { markdown: string; at: number }>();

  constructor(
    private readonly agenticProfileService: AgenticProfileService,
    private readonly fsTools: FilesystemToolsService,
    private readonly keyBalancerService: KeyBalancerService,
    private readonly skillsService: SkillsService,
    private readonly mentionsService: MentionsService,
  ) {}

  getStatus() {
    return {
      localAgentMode: this.fsTools.enabled,
      workspaceRoots: this.fsTools.workspaceRoots,
      maxSteps: MAX_STEPS,
    };
  }

  async *streamChat(
    messages: LocalAgentMessage[],
    token: AppToken,
    agenticProfileId?: string,
    orgId?: string,
    attachedSources?: IAttachedSourceRef[],
  ): AsyncGenerator<LocalAgentStreamEvent> {
    // `orgId` arrives already validated from the controller (`req.ctx.orgId`). The token fallback
    // only covers callers that reach the service directly, never a value chosen by a request body.
    const resolvedOrgId = orgId ?? token['orgId'];
    // Unlike the ACP engines, this harness rebuilds the system prompt on every request, so an
    // attachment lives only in the turn that carried it — the model will not see it again later.
    const attachedBlock = attachedSources?.length
      ? await this.buildAttachedSourcesBlock(agenticProfileId, attachedSources, resolvedOrgId).catch(error => {
          this.logger.warn(`Could not resolve attached sources for profile ${agenticProfileId ?? '-'}: ${error?.message}`);
          return null;
        })
      : null;

    // Tools are built BEFORE the prompt on purpose: the context index has to name the tools this
    // run actually registers, so it reads them from the same object the model gets. Add or remove a
    // tool and the injected context follows without anyone remembering to update a list.
    const tools = {
      ...this.fsTools.buildTools(),
      ...(agenticProfileId
        ? {
            getProfileSource: tool({
              description: 'Load the complete content of a knowledge source, skill, memory, or exploration linked to the active agent profile. Use the source ID shown in the profile index.',
              inputSchema: z.object({ sourceId: z.string().describe('Linked source ID from the agent profile context index.') }),
              execute: ({ sourceId }) => this.agenticProfileService.getLinkedContextResource(agenticProfileId, sourceId, resolvedOrgId),
            }),
            getSkill: tool({
              description:
                'Load a skill, or ONE atomic capability of it. Prefer the capability slug (`bundle:capability`, e.g. `agent-profile-specs:send-inbox`) over the bundle: it returns only the documents that operation needs instead of the whole skill. `file` narrows further to a single document. Executable scripts come back as paths under `scripts`, to run from the workspace — never as content.',
              inputSchema: z.object({
                slugOrId: z.string().describe('Skill slug, capability slug (`bundle:capability`), or id, as listed in the profile index.'),
                file: z.string().optional().describe('Optional: a single relative path of the skill, e.g. `reference/inbox-messaging.md`.'),
              }),
              execute: ({ slugOrId, file }) => this.skillsService.resolve(slugOrId, resolvedOrgId, file),
            }),
          }
        : {}),
    };
    const runtime = this.describeRuntime(tools);
    const { system, profileContext } = await this.buildSystemPrompt(token, resolvedOrgId, agenticProfileId, runtime);
    if (profileContext) yield { type: 'context-snapshot', context: this.createContextSnapshot(profileContext, runtime) };
    if (attachedBlock?.attached.length) yield { type: 'attached-sources', attached: attachedBlock.attached };

    const model = process.env.LOCAL_AGENT_MODEL ?? 'gemini-3.5-flash-lite';
    const { googleProvider, balancedKey } = await this.keyBalancerService.createGoogleProvider(model, token);
    const keyName = balancedKey?.name || balancedKey?.id || (balancedKey?.key ? 'balanced-key' : 'env-fallback-key');
    
    this.logger.log(`🔑 LocalAgentChatStream using key '${keyName}' (type: ${balancedKey?.keyType || 'default'}) for model '${model}'`);


    // The attached block travels as a USER message, not inside the system prompt.
    //
    // With profile-only mentions the distinction was cosmetic; now the text can be an organization
    // source nobody on the team wrote — a transcript, a scraped page. Concatenating that into the
    // system prompt would hand third-party text the authority of our own instructions. It goes in
    // just before the message that pinned it, which is also where the model expects the user's
    // attachments to be.
    const conversationMessages = messages.filter((m: any) => m.role !== 'system') as any[];
    if (attachedBlock?.markdown) {
      const lastUserIndex = conversationMessages.map((m: any) => m.role).lastIndexOf('user');
      const insertAt = lastUserIndex >= 0 ? lastUserIndex : conversationMessages.length;
      conversationMessages.splice(insertAt, 0, { role: 'user', content: attachedBlock.markdown });
    }

    const result = streamText({
      model: googleProvider(model),
      instructions: system,
      messages: conversationMessages,
      stopWhen: isStepCount(MAX_STEPS),
      tools,
    });

    for await (const part of result.stream as AsyncIterable<any>) {
      switch (part.type) {
        case 'text-delta':
          yield { type: 'text-delta', text: part.text ?? part.textDelta ?? '' };
          break;
        case 'reasoning-delta':
          yield { type: 'reasoning-delta', text: part.reasoningDelta ?? '' };
          break;
        case 'tool-call':
          yield { type: 'tool-call', toolName: part.toolName, input: part.input ?? part.args };
          break;
        case 'tool-result':
          yield { type: 'tool-result', toolName: part.toolName, output: part.output ?? part.result };
          break;
        case 'error':
          if (balancedKey?.key) {
            this.keyBalancerService.recordFailedRequest('google', balancedKey.key, model, String(part.error?.message ?? part.error)).catch(() => {});
          }
          yield { type: 'error', error: String(part.error?.message ?? part.error) };
          break;
        case 'finish':
          if (balancedKey?.id) {
            const usageObj = part.totalUsage ?? part.usage;
            const totalTokens = usageObj?.totalTokens;
            if (totalTokens) {
              this.keyBalancerService.updateUsage(balancedKey.id, totalTokens).catch(() => {});
            }
          }
          yield { type: 'finish', usage: normalizeTokenUsage(part.totalUsage ?? part.usage, {
            provider: 'google', model, source: 'vercel-ai-sdk',
          }) };
          break;
      }
    }
  }

  /**
   * The system prompt carries the agent's identity and its standing profile context — never the
   * `@mention` attachments, which travel as a user message so third-party text cannot borrow the
   * authority of our own instructions.
   */
  private async buildSystemPrompt(
    token: AppToken,
    orgId?: string,
    agenticProfileId?: string,
    runtime?: AgenticRuntimeProfile,
  ): Promise<{ system: string; profileContext: string }> {
    let profileContext = '';
    if (agenticProfileId) {
      profileContext = await this.getProfileContext(agenticProfileId, orgId, undefined, runtime);
    }

    const roots = this.fsTools.workspaceRoots;
    const toolsNote = this.fsTools.enabled
      ? `You have filesystem tools (readFile, writeFile, editFile, listDir, glob, grep) over the local machine, restricted to these workspace roots:
${roots.map(r => `- ${r}`).join('\n')}

Rules:
- Your agent profile references files with file:// links — use readFile to load them when relevant.
- For indexed profile knowledge stored in Control Markets, use getProfileSource with its source ID when the full content is needed.
- Read before you write: inspect existing files and follow their conventions.
- Prefer editFile for small changes; writeFile for new files.
- After file operations, summarize exactly which files you created or changed with their paths.`
      : `Filesystem tools are DISABLED on this server (LOCAL_AGENT_MODE is off). Tell the user if they ask for file operations.`;

    const system = `You are a local agent harness assistant for Control Markets, running on the user's own machine.

${profileContext ? `# AGENT PROFILE (your identity, knowledge and tasks)\n\n${profileContext}\n\n` : ''}${toolsNote}

Current user: ${token.name ?? token.email} (userId: ${token.userId}, orgId: ${orgId ?? 'unknown'}).
Answer in the user's language.`;
    return { system, profileContext };
  }

  createContextSnapshot(content: string, runtime?: AgenticRuntimeProfile): InjectedContextSnapshot {
    return createInjectedContextSnapshot(content, runtime);
  }

  /**
   * Resolves what the user attached with `@` for ONE turn and renders it as markdown.
   *
   * Goes through `MentionsService`, so a ref may be one of the profile's own resources, any source
   * of the organization, or another agent's capability card — the profile is now optional, which is
   * what lets a chat without one (`/page/local-agent-chat`) attach things too.
   *
   * Deliberately not cached: `contextCache` holds the profile context, which is stable for minutes,
   * while attachments change with every message — caching them would serve the previous turn's
   * documents to the current question.
   */
  async buildAttachedSourcesBlock(
    profileId: string | undefined,
    refs: IAttachedSourceRef[],
    orgId?: string,
  ): Promise<{ markdown: string; attached: AttachedSourceReport[] }> {
    if (!refs?.length) return { markdown: '', attached: [] };
    const resources = await this.mentionsService.resolve(refs, { orgId: orgId as string, profileId });
    return formatAttachedSourcesBlock(resources);
  }

  /**
   * The runtime this harness offers a context reader, derived from the tool set that was just
   * built for the model — never from a hardcoded list, which would drift the first time a tool
   * is added or removed.
   */
  describeRuntime(tools: Record<string, unknown>): AgenticRuntimeProfile {
    return {
      engine: 'builtin',
      tools: Object.keys(tools),
      // Only claimed when the filesystem tools are actually on; the renderer still verifies each
      // file before printing its path, so a root without the wiki prints nothing.
      workspaceRoots: this.fsTools.enabled ? this.fsTools.workspaceRoots : undefined,
    };
  }

  /**
   * The runtime takes part in the cache key because it takes part in the composition: without it,
   * a built-in chat and an ACP session five minutes apart would share one entry, and one of the two
   * would be served an index written for the other's tools.
   */
  async getProfileContext(profileId: string, orgId?: string, levelOverride?: AgenticContextLevel, runtime?: AgenticRuntimeProfile): Promise<string> {
    const key = `${profileId}:${orgId ?? ''}:${levelOverride ?? 'profile-default'}:${runtimeCacheKey(runtime)}`;
    const cached = this.contextCache.get(key);
    if (cached && Date.now() - cached.at < CONTEXT_CACHE_TTL_MS) return cached.markdown;

    const markdown = await this.agenticProfileService.composeFullContext(profileId, orgId, levelOverride, runtime);
    this.contextCache.set(key, { markdown, at: Date.now() });
    return markdown;
  }
}
