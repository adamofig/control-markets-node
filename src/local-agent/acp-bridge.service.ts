import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { spawn, execFile, ChildProcessWithoutNullStreams } from 'child_process';
import { Readable, Writable } from 'stream';
import { randomUUID } from 'crypto';
import { FilesystemToolsService } from './filesystem-tools.service';
import { LocalAgentStreamEvent } from './local-agent-chat.service';

// @agentclientprotocol/sdk is ESM-only; the project compiles to CommonJS, so a static
// import would become require() and fail. new Function keeps the dynamic import as-is.
const loadAcpSdk = new Function('return import("@agentclientprotocol/sdk")') as () => Promise<any>;

const IDLE_TTL_MS = 15 * 60 * 1000;
const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingPermission {
  resolve: (optionId: string | null) => void;
  options: { optionId: string; name: string; kind: string }[];
}

interface AcpSession {
  id: string; // our bridge session id (stable across respawns)
  acpSessionId: string; // CLI-side session id (session/new result)
  process: ChildProcessWithoutNullStreams;
  connection: any; // acp.ClientSideConnection
  queue: AsyncEventQueue | null; // active SSE queue for the in-flight turn
  pendingPermissions: Map<string, PendingPermission>;
  toolNames: Map<string, string>; // toolCallId → title (for tool_call_update mapping)
  contextSent: boolean;
  lastUsedAt: number;
}

/** Minimal async queue so JSON-RPC notification callbacks can feed an async generator. */
class AsyncEventQueue {
  private items: LocalAgentStreamEvent[] = [];
  private waiter: ((v: void) => void) | null = null;
  private closed = false;

  push(event: LocalAgentStreamEvent) {
    if (this.closed) return;
    this.items.push(event);
    this.waiter?.();
    this.waiter = null;
  }

  close() {
    this.closed = true;
    this.waiter?.();
    this.waiter = null;
  }

  async *drain(): AsyncGenerator<LocalAgentStreamEvent> {
    while (true) {
      while (this.items.length) yield this.items.shift()!;
      if (this.closed) return;
      await new Promise<void>(resolve => (this.waiter = resolve));
    }
  }
}

@Injectable()
export class AcpBridgeService implements OnModuleDestroy {
  private logger = new Logger(AcpBridgeService.name);
  private sessions = new Map<string, AcpSession>();
  private geminiVersion: string | null | undefined; // undefined = not probed yet
  private reaper = setInterval(() => this.reapIdleSessions(), 60_000);

  constructor(private readonly fsTools: FilesystemToolsService) {}

  onModuleDestroy() {
    clearInterval(this.reaper);
    for (const session of this.sessions.values()) session.process.kill('SIGTERM');
    this.sessions.clear();
  }

  get enabled(): boolean {
    return this.fsTools.enabled;
  }

  /** Probes `gemini --version` once and caches the result. */
  async getAcpStatus(): Promise<{ acpAvailable: boolean; geminiVersion: string | null }> {
    if (this.geminiVersion === undefined) {
      this.geminiVersion = await new Promise<string | null>(resolve => {
        execFile('gemini', ['--version'], { timeout: 10_000, shell: process.platform === 'win32' }, (err, stdout) =>
          resolve(err ? null : stdout.trim()),
        );
      });
    }
    return { acpAvailable: this.enabled && this.geminiVersion !== null, geminiVersion: this.geminiVersion };
  }

  /**
   * Streams one prompt turn through the Gemini CLI (ACP). Yields the same SSE event union
   * as the built-in harness, plus `session`, `permission-request` and `plan` events.
   */
  async *stream(message: string, sessionId?: string, profileContext?: string): AsyncGenerator<LocalAgentStreamEvent> {
    if (!this.enabled) {
      yield { type: 'error', error: 'LOCAL_AGENT_MODE is disabled on this server.' };
      return;
    }

    let session: AcpSession;
    try {
      session = await this.getOrCreateSession(sessionId);
    } catch (error) {
      yield { type: 'error', error: `Could not start Gemini CLI (ACP): ${error?.message ?? error}` };
      return;
    }

    if (session.queue) {
      yield { type: 'error', error: 'This session already has a turn in progress.' };
      return;
    }

    yield { type: 'session', sessionId: session.id };

    const queue = new AsyncEventQueue();
    session.queue = queue;
    session.lastUsedAt = Date.now();

    const prompt: any[] = [];
    if (profileContext && !session.contextSent) {
      prompt.push({
        type: 'resource',
        resource: { uri: 'context://agentic-profile', mimeType: 'text/markdown', text: profileContext },
      });
      session.contextSent = true;
    }
    prompt.push({ type: 'text', text: message });

    const turn = session.connection
      .prompt({ sessionId: session.acpSessionId, prompt })
      .then((result: any) => queue.push({ type: 'finish', usage: { stopReason: result.stopReason } }))
      .catch((error: any) => queue.push({ type: 'error', error: String(error?.message ?? error) }))
      .finally(() => queue.close());

    try {
      yield* queue.drain();
    } finally {
      await turn.catch(() => undefined);
      session.queue = null;
      session.lastUsedAt = Date.now();
    }
  }

  /** Resolves a pending `session/request_permission` with the user's chosen option. */
  respondPermission(sessionId: string, requestId: string, optionId: string): { ok: boolean; error?: string } {
    const session = this.sessions.get(sessionId);
    const pending = session?.pendingPermissions.get(requestId);
    if (!session || !pending) return { ok: false, error: 'No pending permission request with that id.' };
    if (!pending.options.some(o => o.optionId === optionId)) return { ok: false, error: `Unknown optionId: ${optionId}` };
    session.pendingPermissions.delete(requestId);
    pending.resolve(optionId);
    return { ok: true };
  }

  /** Sends session/cancel for the in-flight turn. */
  async cancel(sessionId: string): Promise<{ ok: boolean }> {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false };
    for (const [id, pending] of session.pendingPermissions) {
      pending.resolve(null); // resolves as cancelled outcome
      session.pendingPermissions.delete(id);
    }
    await session.connection.cancel({ sessionId: session.acpSessionId }).catch(() => undefined);
    return { ok: true };
  }

  private async getOrCreateSession(sessionId?: string): Promise<AcpSession> {
    const existing = sessionId ? this.sessions.get(sessionId) : undefined;
    if (existing && existing.process.exitCode === null) return existing;

    const acp = await loadAcpSdk();
    const roots = this.fsTools.workspaceRoots;
    const cwd = roots[0];
    if (!cwd) throw new Error('No LOCAL_AGENT_WORKSPACE_ROOTS configured.');

    // The backend's Google Cloud vars (Vertex AI service account, project id) must not leak into
    // the CLI: with them set, gemini switches from personal OAuth to project-billed Code Assist
    // and fails with 403 IAM_PERMISSION_DENIED on cloudaicompanion.googleapis.com.
    const env = { ...process.env };
    delete env.GOOGLE_CLOUD_PROJECT;
    delete env.GOOGLE_CLOUD_PROJECT_ID;
    delete env.GOOGLE_APPLICATION_CREDENTIALS;
    delete env.GOOGLE_GENAI_USE_VERTEXAI;
    delete env.GOOGLE_CLOUD_LOCATION;

    const args = ['--acp'];
    if (roots.length > 1) {
      args.push('--include-directories', roots.slice(1).join(','));
    }
    const child = spawn('gemini', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.on('data', (chunk: Buffer) => this.logger.debug(`[gemini --acp] ${chunk.toString().trim()}`));

    const session: AcpSession = {
      id: existing?.id ?? sessionId ?? randomUUID(),
      acpSessionId: existing?.acpSessionId ?? '',
      process: child,
      connection: null,
      queue: null,
      pendingPermissions: new Map(),
      toolNames: existing?.toolNames ?? new Map(),
      contextSent: existing?.contextSent ?? false,
      lastUsedAt: Date.now(),
    };

    const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
    session.connection = new acp.ClientSideConnection(() => this.buildClientHandler(session), stream);

    child.on('exit', code => {
      this.logger.warn(`gemini --acp exited (code ${code}) for session ${session.id}`);
      session.queue?.push({ type: 'error', error: `Gemini CLI process exited (code ${code}).` });
      session.queue?.close();
    });

    const init = await session.connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    });
    this.logger.log(`ACP initialized (protocol v${init.protocolVersion})`);

    if (session.acpSessionId && init.agentCapabilities?.loadSession) {
      await session.connection.loadSession({ sessionId: session.acpSessionId, cwd, mcpServers: [] });
    } else {
      const created = await session.connection.newSession({ cwd, mcpServers: [] });
      session.acpSessionId = created.sessionId;
    }

    this.sessions.set(session.id, session);
    return session;
  }

  /** Implements the ACP `Client` interface: streaming updates, permissions and sandboxed fs. */
  private buildClientHandler(session: AcpSession) {
    return {
      sessionUpdate: async (params: any) => {
        const update = params.update;
        const event = this.mapUpdate(session, update);
        if (event) session.queue?.push(event);
      },

      requestPermission: async (params: any) => {
        const requestId = randomUUID();
        const options = (params.options ?? []).map((o: any) => ({ optionId: o.optionId, name: o.name, kind: o.kind }));
        const decision = await new Promise<string | null>(resolve => {
          session.pendingPermissions.set(requestId, { resolve, options });
          session.queue?.push({
            type: 'permission-request',
            requestId,
            toolName: params.toolCall?.title ?? 'tool',
            rationale: params.toolCall?.kind ?? '',
            options,
          });
          setTimeout(() => {
            if (session.pendingPermissions.delete(requestId)) resolve(null);
          }, PERMISSION_TIMEOUT_MS);
        });
        return decision ? { outcome: { outcome: 'selected', optionId: decision } } : { outcome: { outcome: 'cancelled' } };
      },

      readTextFile: async (params: any) => ({
        content: await this.fsTools.readTextFileSafe(params.path, params.line, params.limit),
      }),

      writeTextFile: async (params: any) => {
        await this.fsTools.writeTextFileSafe(params.path, params.content);
        return {};
      },
    };
  }

  private mapUpdate(session: AcpSession, update: any): LocalAgentStreamEvent | null {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        return update.content?.type === 'text' ? { type: 'text-delta', text: update.content.text } : null;
      case 'agent_thought_chunk':
        return update.content?.type === 'text' ? { type: 'reasoning-delta', text: update.content.text } : null;
      case 'tool_call':
        session.toolNames.set(update.toolCallId, update.title ?? update.kind ?? 'tool');
        return { type: 'tool-call', toolName: session.toolNames.get(update.toolCallId)!, input: update.rawInput ?? update.locations ?? '' };
      case 'tool_call_update': {
        if (update.status !== 'completed' && update.status !== 'failed') return null;
        const toolName = session.toolNames.get(update.toolCallId) ?? 'tool';
        const output =
          update.content
            ?.map((c: any) => c?.content?.text ?? c?.content?.type ?? '')
            .filter(Boolean)
            .join('\n') ?? update.status;
        return { type: 'tool-result', toolName, output: update.status === 'failed' ? `FAILED: ${output}` : output };
      }
      case 'plan':
        return { type: 'plan', entries: update.entries ?? [] };
      default:
        return null;
    }
  }

  private reapIdleSessions() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (!session.queue && now - session.lastUsedAt > IDLE_TTL_MS) {
        this.logger.log(`Reaping idle ACP session ${id}`);
        session.process.kill('SIGTERM');
        this.sessions.delete(id);
      }
    }
  }
}
