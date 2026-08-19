import { Injectable, Logger } from '@nestjs/common';
import { AppToken } from '@dataclouder/nest-auth';
import { AcpBridgeService } from '../../local-agent/acp-bridge.service';
import { LocalAgentChatService, LocalAgentStreamEvent } from '../../local-agent/local-agent-chat.service';
import { WorkspaceService } from '../../workspaces/services/workspace.service';
import { AppUserService } from '../../user/user.service';
import { AcpEngine, DEFAULT_ACP_ENGINE, asAcpEngine } from '../../common/acp-engines';
import { IAgenticConversationTool, IAgenticTokenUsage } from '../../agentic-conversation/models/agentic-conversation.models';
import { IInboxAgentExecutionSnapshot } from '../models/inbox.models';
import { InboxAgentIdentityService, ResolvedInboxAgentIdentity } from './inbox-agent-identity.service';
import { InboxAgentMessageService } from './inbox-agent-message.service';
import { InboxConversationService } from './inbox-conversation.service';
import { InboxEventService } from './inbox-event.service';
import { InboxMessageService } from './inbox-message.service';

const REPLY_TIMEOUT_MS = Math.min(Math.max(Number(process.env.INBOX_AGENT_REPLY_TIMEOUT_MS) || 3 * 60_000, 30_000), 15 * 60_000);
const MAX_REPLY_CHARS = 18_000;
const HISTORY_TURNS = 20;

/** What the agent was asked to do and how to behave while it does it, inside Control Inbox. */
function buildInboxDirective(userName: string): string {
  return [
    '<control_inbox>',
    'Estás respondiendo dentro de Control Inbox, la bandeja de mensajería interna de Control Markets.',
    `Tu interlocutor humano es ${userName}.`,
    'Reglas de esta conversación:',
    '- Responde SIEMPRE en el idioma en el que te escriben.',
    '- Tono conversacional y directo, como un chat de trabajo. Sé breve salvo que te pidan detalle.',
    '- Markdown ligero (listas, negritas, código) solo cuando aporte; nada de reportes largos si no los piden.',
    '- No modifiques archivos ni ejecutes acciones destructivas a menos que te lo pidan explícitamente en este hilo.',
    '- Si una petición requiere trabajo largo, dilo, confirma que la tomas y explica qué harás.',
    '</control_inbox>',
  ].join('\n');
}

/**
 * Reactive responder for `type: 'agent'` threads: when a human writes, the agent answers in the
 * same thread as one ordinary message.
 *
 * It runs detached from the HTTP request that triggered it — the sender's POST returns as soon as
 * the user's own message is durable, and the reply arrives later over SSE like any other message.
 * The turn is executed on the profile's default engine (`acpConfig.defaultEngine`), falling back to
 * the in-process Vercel harness when no ACP CLI is reachable on this host, so a deployed backend
 * without CLIs still holds a conversation.
 */
@Injectable()
export class InboxAgentDispatcherService {
  private readonly logger = new Logger(InboxAgentDispatcherService.name);
  /** One in-flight reply per conversation: a second message while the agent thinks is queued by the user, not by us. */
  private readonly running = new Set<string>();

  constructor(
    private readonly conversations: InboxConversationService,
    private readonly messages: InboxMessageService,
    private readonly agentIdentities: InboxAgentIdentityService,
    private readonly agentMessages: InboxAgentMessageService,
    private readonly acpBridge: AcpBridgeService,
    private readonly localAgentChat: LocalAgentChatService,
    private readonly workspaces: WorkspaceService,
    private readonly events: InboxEventService,
    private readonly users: AppUserService
  ) {}

  /**
   * Fire-and-forget entry point. Never rejects: a failed reply is reported inside the thread.
   *
   * The promise is returned so tests can await the turn; production callers ignore it on purpose —
   * awaiting it would hold the user's POST open for the whole model run.
   */
  dispatch(orgId: string, conversationId: string, triggerMessageId: string, actorDisplayName: string): Promise<void> {
    const key = `${orgId}:${conversationId}`;
    if (this.running.has(key)) {
      this.logger.log(`Skipping agent dispatch for ${conversationId}: a reply is already in flight`);
      return Promise.resolve();
    }
    this.running.add(key);
    return this.reply(orgId, conversationId, triggerMessageId, actorDisplayName)
      .catch(error => this.logger.error(`Agent dispatch failed for ${conversationId}: ${error?.message ?? error}`))
      .finally(() => this.running.delete(key));
  }

  private async reply(orgId: string, conversationId: string, triggerMessageId: string, actorDisplayName: string): Promise<void> {
    const conversation = await this.conversations.findById(orgId, conversationId);
    const agenticProfileId = conversation?.agentContext?.agenticProfileId;
    if (!conversation || conversation.type !== 'agent' || !agenticProfileId) return;

    const agent = await this.agentIdentities.resolveInternal(orgId, agenticProfileId);
    const recipients = await this.conversations.recipientRefIds(orgId, conversationId);
    const notify = (state: 'thinking' | 'idle', detail?: string) =>
      this.events.emit(
        'inbox.agent.status',
        orgId,
        conversationId,
        { conversationId, agentParticipantId: agent.participant.participantId, displayName: agent.participant.displayName, state, detail },
        recipients
      );

    notify('thinking');
    const startedAt = Date.now();
    try {
      const turns = await this.messages.recentTurns(orgId, conversationId, HISTORY_TURNS);
      const engine = asAcpEngine(conversation.agentContext?.engine) ?? agent.acpConfig?.defaultEngine ?? DEFAULT_ACP_ENGINE;
      const useAcp = await this.isAcpUsable(engine);

      const outcome = useAcp
        ? await this.runAcp(agent, conversation, turns, engine, actorDisplayName, detail => notify('thinking', detail))
        : await this.runBuiltin(agent, orgId, turns, actorDisplayName);

      const text = outcome.text.trim();
      const execution: IInboxAgentExecutionSnapshot = {
        mode: 'conversational',
        status: outcome.error && !text ? 'failed' : 'completed',
        engine: outcome.engine,
        externalSessionId: outcome.sessionId,
        ...(outcome.reasoning ? { reasoning: outcome.reasoning.slice(0, MAX_REPLY_CHARS) } : {}),
        ...(outcome.tools.length ? { tools: outcome.tools } : {}),
        ...(outcome.usage !== undefined ? { usage: outcome.usage } : {}),
        ...(outcome.error ? { error: outcome.error } : {}),
      };

      await this.agentMessages.sendInternalToConversation(
        agent,
        conversationId,
        {
          clientMessageId: `agent-reply:${triggerMessageId}`.slice(0, 128),
          parts: [{ type: 'text', format: 'markdown', text: text || this.failureText(outcome.error) }],
        },
        { type: 'local', executionId: `inbox:${conversationId}:${triggerMessageId}`, engine: outcome.engine },
        execution
      );

      this.logger.log(
        `Agent ${agent.participant.displayName} replied in ${conversationId} via ${outcome.engine} — ${text.length} chars, ${outcome.tools.length} tool(s), ${Date.now() - startedAt}ms`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Could not produce an agent reply for ${conversationId}: ${message}`);
      // The user is waiting in a chat; silence would read as the agent ignoring them.
      await this.agentMessages
        .sendInternalToConversation(
          agent,
          conversationId,
          {
            clientMessageId: `agent-reply-error:${triggerMessageId}`.slice(0, 128),
            parts: [{ type: 'text', format: 'plain', text: this.failureText(message) }],
          },
          { type: 'local', executionId: `inbox:${conversationId}:${triggerMessageId}` },
          { mode: 'conversational', status: 'failed', error: message }
        )
        .catch(() => undefined);
    } finally {
      notify('idle');
    }
  }

  /** ACP needs a CLI on this host. Absent one, the built-in harness keeps the chat alive. */
  private async isAcpUsable(engine: AcpEngine): Promise<boolean> {
    if (!this.acpBridge.enabled) return false;
    const status = await this.acpBridge.getAcpStatus().catch(() => null);
    return !!status?.engines?.[engine]?.available;
  }

  /**
   * Runs the turn through the profile's ACP CLI.
   *
   * The CLI keeps its own session history, so a resumed session receives only the new message while
   * a cold one gets the profile context plus a compact transcript. Permissions are auto-approved:
   * nobody can answer a HITL prompt from a chat bubble yet, and a hung request would look like the
   * agent went silent. That is the deliberate limit of this first conversational mode.
   */
  private async runAcp(
    agent: ResolvedInboxAgentIdentity,
    conversation: Record<string, any>,
    turns: { role: 'user' | 'assistant'; content: string }[],
    engine: AcpEngine,
    actorDisplayName: string,
    onStatus: (detail: string) => void
  ): Promise<TurnOutcome> {
    const resumedSessionId = conversation.agentContext?.externalSessionId as string | undefined;
    const profileContext = resumedSessionId
      ? undefined
      : await this.localAgentChat.getProfileContext(agent.agenticProfileId, agent.orgId).catch(() => undefined);

    const prompt = resumedSessionId
      ? `${buildInboxDirective(actorDisplayName)}\n\n${turns[turns.length - 1]?.content ?? ''}`
      : `${buildInboxDirective(actorDisplayName)}\n\n${this.renderTranscript(turns)}`;

    // Model and effort only apply when the thread runs on the engine those defaults were written
    // for — engine-specific model ids are not portable and the CLI would reject a foreign one.
    const inheritsDefaults = !!agent.acpConfig?.defaultEngine && engine === agent.acpConfig.defaultEngine;
    // Task 25 — an inbox reply is as unattended as a heartbeat: whoever wrote the message is not
    // a member the server can authorise, so the session borrows the organization's acting identity
    // exactly as the cron path does. No identity, no tools; the reply still goes out.
    const actingIdentity = await this.users.findOrgActingIdentity(agent.orgId).catch(() => null);
    const runtimeOptions = {
      cwd: this.workspaces.resolveRootForHost(agent.workspaceId ?? '') ?? undefined,
      model: inheritsDefaults ? agent.acpConfig?.defaultModel : undefined,
      reasoningEffort: inheritsDefaults ? agent.acpConfig?.reasoningEffort : undefined,
      orgId: actingIdentity ? agent.orgId : undefined,
      profileId: agent.agenticProfileId,
      actorEmail: actingIdentity?.email,
      actorUserId: actingIdentity?.userId,
    };

    const outcome = this.emptyOutcome(engine);
    const deadline = Date.now() + REPLY_TIMEOUT_MS;

    for await (const event of this.acpBridge.stream(prompt, resumedSessionId, profileContext, engine, runtimeOptions)) {
      if (Date.now() > deadline) {
        outcome.error = `La respuesta superó el límite de ${Math.round(REPLY_TIMEOUT_MS / 60_000)} minuto(s).`;
        if (outcome.sessionId) await this.acpBridge.cancel(outcome.sessionId).catch(() => undefined);
        break;
      }
      if (event.type === 'session') {
        outcome.sessionId = event.sessionId;
        if (event.sessionId !== resumedSessionId) {
          await this.conversations.updateAgentSession(agent.orgId, conversation.id, event.sessionId).catch(() => undefined);
        }
        continue;
      }
      if (event.type === 'permission-request') {
        const preferred = event.options.find(option => option.kind === 'allow_always') ?? event.options.find(option => option.kind === 'allow_once') ?? event.options[0];
        if (outcome.sessionId && preferred) this.acpBridge.respondPermission(outcome.sessionId, event.requestId, preferred.optionId);
        continue;
      }
      if (event.type === 'status') {
        onStatus(event.message);
        continue;
      }
      this.absorb(outcome, event);
    }

    // A resumed session the CLI no longer knows about comes back empty; drop the binding so the
    // next turn starts cold with the full profile context instead of failing forever.
    if (resumedSessionId && !outcome.text.trim() && outcome.error) {
      await this.conversations.updateAgentSession(agent.orgId, conversation.id, undefined).catch(() => undefined);
    }
    return outcome;
  }

  /** In-process Vercel AI harness — always available, and the path a deployed backend takes. */
  private async runBuiltin(
    agent: ResolvedInboxAgentIdentity,
    orgId: string,
    turns: { role: 'user' | 'assistant'; content: string }[],
    actorDisplayName: string
  ): Promise<TurnOutcome> {
    const token = {
      userId: `inbox-agent:${agent.agenticProfileId}`,
      email: undefined,
      name: agent.participant.displayName,
      orgId,
    } as unknown as AppToken;

    const messages = [...turns];
    const last = messages.pop();
    const withDirective = [...messages, { role: 'user' as const, content: `${buildInboxDirective(actorDisplayName)}\n\n${last?.content ?? ''}` }];

    const outcome = this.emptyOutcome('builtin');
    const deadline = Date.now() + REPLY_TIMEOUT_MS;
    for await (const event of this.localAgentChat.streamChat(withDirective, token, agent.agenticProfileId, orgId)) {
      if (Date.now() > deadline) {
        outcome.error = `La respuesta superó el límite de ${Math.round(REPLY_TIMEOUT_MS / 60_000)} minuto(s).`;
        break;
      }
      this.absorb(outcome, event);
    }
    return outcome;
  }

  private absorb(outcome: TurnOutcome, event: LocalAgentStreamEvent): void {
    switch (event.type) {
      case 'text-delta':
        if (outcome.text.length < MAX_REPLY_CHARS) outcome.text += event.text;
        break;
      case 'reasoning-delta':
        if (outcome.reasoning.length < MAX_REPLY_CHARS) outcome.reasoning += event.text;
        break;
      case 'tool-call':
        outcome.tools.push({ toolName: event.toolName, input: this.truncate(event.input), status: 'executing' });
        break;
      case 'tool-result': {
        const pending = [...outcome.tools].reverse().find(tool => tool.toolName === event.toolName && tool.status === 'executing');
        if (pending) {
          pending.output = this.truncate(event.output);
          pending.status = 'completed';
        }
        break;
      }
      case 'finish':
        outcome.usage = event.usage as IAgenticTokenUsage | undefined;
        break;
      case 'error':
        outcome.error = event.error;
        break;
      default:
        break;
    }
  }

  private emptyOutcome(engine: string): TurnOutcome {
    return { text: '', reasoning: '', tools: [], engine, error: undefined, sessionId: undefined, usage: undefined };
  }

  private renderTranscript(turns: { role: 'user' | 'assistant'; content: string }[]): string {
    if (turns.length <= 1) return turns[0]?.content ?? '';
    const history = turns.slice(0, -1).map(turn => `${turn.role === 'user' ? 'Usuario' : 'Tú'}: ${turn.content}`);
    return [`<historial_reciente>\n${history.join('\n\n')}\n</historial_reciente>`, turns[turns.length - 1].content].join('\n\n');
  }

  private failureText(error?: string): string {
    return `No pude generar una respuesta en este momento.${error ? ` (${error.slice(0, 300)})` : ''}`;
  }

  private truncate(value: unknown, max = 300): string {
    if (value === undefined || value === null) return '';
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    return raw.length > max ? `${raw.slice(0, max)}…` : raw;
  }
}

interface TurnOutcome {
  text: string;
  reasoning: string;
  tools: IAgenticConversationTool[];
  engine: string;
  error?: string;
  sessionId?: string;
  usage?: IAgenticTokenUsage;
}
