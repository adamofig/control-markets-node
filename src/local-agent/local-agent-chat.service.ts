import { Injectable } from '@nestjs/common';
import { streamText, isStepCount, tool } from 'ai';
import { z } from 'zod';
import { createGoogle } from '@ai-sdk/google';
import { AppToken } from '@dataclouder/nest-auth';
import { AgenticProfileService } from '../agentic-profile/services/agentic-profile.service';
import { FilesystemToolsService } from './filesystem-tools.service';
import { normalizeTokenUsage } from './ai-usage.util';
import { AgenticContextLevel } from '../agentic-profile/models/agentic-profile.models';
import { createInjectedContextSnapshot, InjectedContextSnapshot } from './context-snapshot.util';

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
  // ACP (Gemini CLI) engine extras:
  | { type: 'session'; sessionId: string }
  | { type: 'permission-request'; requestId: string; toolName: string; rationale: string; options: { optionId: string; name: string; kind: string }[] }
  | { type: 'plan'; entries: unknown[] }
  | { type: 'status'; message: string };

const MAX_STEPS = 25;
const CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class LocalAgentChatService {
  private google = createGoogle({ apiKey: process.env.GEMINI_API_KEY });
  private contextCache = new Map<string, { markdown: string; at: number }>();

  constructor(
    private readonly agenticProfileService: AgenticProfileService,
    private readonly fsTools: FilesystemToolsService,
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
  ): AsyncGenerator<LocalAgentStreamEvent> {
    const resolvedOrgId = orgId ?? token['orgId'];
    const { system, profileContext } = await this.buildSystemPrompt(token, resolvedOrgId, agenticProfileId);
    if (profileContext) yield { type: 'context-snapshot', context: this.createContextSnapshot(profileContext) };

    const model = process.env.LOCAL_AGENT_MODEL ?? 'gemini-3.1-flash-lite';
    const result = streamText({
      model: this.google(model),
      instructions: system,
      messages,
      stopWhen: isStepCount(MAX_STEPS),
      tools: {
        ...this.fsTools.buildTools(),
        ...(agenticProfileId ? {
          getProfileSource: tool({
            description: 'Load the complete content of a knowledge source, skill, memory, or exploration linked to the active agent profile. Use the source ID shown in the profile index.',
            inputSchema: z.object({ sourceId: z.string().describe('Linked source ID from the agent profile context index.') }),
            execute: ({ sourceId }) => this.agenticProfileService.getLinkedContextResource(
              agenticProfileId,
              sourceId,
              resolvedOrgId,
            ),
          }),
        } : {}),
      },
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
          yield { type: 'error', error: String(part.error?.message ?? part.error) };
          break;
        case 'finish':
          yield { type: 'finish', usage: normalizeTokenUsage(part.totalUsage ?? part.usage, {
            provider: 'google', model, source: 'vercel-ai-sdk',
          }) };
          break;
      }
    }
  }

  private async buildSystemPrompt(token: AppToken, orgId?: string, agenticProfileId?: string): Promise<{ system: string; profileContext: string }> {
    let profileContext = '';
    if (agenticProfileId) {
      profileContext = await this.getProfileContext(agenticProfileId, orgId);
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

  createContextSnapshot(content: string): InjectedContextSnapshot {
    return createInjectedContextSnapshot(content);
  }

  async getProfileContext(profileId: string, orgId?: string, levelOverride?: AgenticContextLevel): Promise<string> {
    const key = `${profileId}:${orgId ?? ''}:${levelOverride ?? 'profile-default'}`;
    const cached = this.contextCache.get(key);
    if (cached && Date.now() - cached.at < CONTEXT_CACHE_TTL_MS) return cached.markdown;

    const markdown = await this.agenticProfileService.composeFullContext(profileId, orgId, levelOverride);
    this.contextCache.set(key, { markdown, at: Date.now() });
    return markdown;
  }
}
