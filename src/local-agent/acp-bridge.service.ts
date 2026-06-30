import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { spawn, execFile, ChildProcessWithoutNullStreams } from 'child_process';
import { Readable, Writable } from 'stream';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { FilesystemToolsService } from './filesystem-tools.service';
import { LocalAgentStreamEvent } from './local-agent-chat.service';

// @agentclientprotocol/sdk is ESM-only; the project compiles to CommonJS, so a static
// import would become require() and fail. new Function keeps the dynamic import as-is.
const loadAcpSdk = new Function('return import("@agentclientprotocol/sdk")') as () => Promise<any>;

const IDLE_TTL_MS = 15 * 60 * 1000;
const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

/** ACP agents the bridge can spawn. The protocol is agent-agnostic — only the command differs. */
export type AcpEngine = 'gemini' | 'claude' | 'agy';

interface EngineConfig {
  /** Env var that overrides the spawn command (executable + args, space-separated). */
  commandEnv: string;
  /** Default spawn command if the env var is unset. */
  defaultCommand: string;
  /** Whether the CLI accepts `--include-directories` for extra workspace roots (Gemini only). */
  supportsIncludeDirs: boolean;
  /** Env vars stripped from the spawned process so the CLI uses personal auth / doesn't crash. */
  stripEnv: string[];
  /** Command used to probe availability/version (executable + args, space-separated). */
  versionCommand: string;
}

const ENGINE_CONFIGS: Record<AcpEngine, EngineConfig> = {
  gemini: {
    commandEnv: 'LOCAL_AGENT_GEMINI_COMMAND',
    defaultCommand: 'gemini --acp',
    supportsIncludeDirs: true,
    // With these present (the backend sets them for Vertex AI) gemini switches from personal OAuth
    // to project-billed Code Assist and fails with 403 IAM_PERMISSION_DENIED.
    stripEnv: [
      'GOOGLE_CLOUD_PROJECT',
      'GOOGLE_CLOUD_PROJECT_ID',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'GOOGLE_GENAI_USE_VERTEXAI',
      'GOOGLE_CLOUD_LOCATION',
    ],
    versionCommand: 'gemini --version',
  },
  claude: {
    // The official Zed adapter bridges the Claude Agent SDK to ACP (npx auto-fetches it).
    commandEnv: 'LOCAL_AGENT_CLAUDE_COMMAND',
    defaultCommand: 'npx -y @zed-industries/claude-code-acp',
    supportsIncludeDirs: false,
    // CLAUDECODE/CLAUDE_CODE_* are set when the backend itself runs under Claude Code; the adapter
    // then refuses to launch ("cannot be launched inside another Claude Code session").
    stripEnv: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT'],
    versionCommand: 'claude --version',
  },
  agy: {
    commandEnv: 'LOCAL_AGENT_AGY_COMMAND',
    defaultCommand: 'agy-acp',
    supportsIncludeDirs: false,
    stripEnv: [],
    versionCommand: 'agy --version',
  },
};

/** Splits a "exe arg1 arg2" command string into [executable, ...args] (whitespace-separated). */
function parseCommand(command: string): [string, string[]] {
  const [exe, ...args] = command.trim().split(/\s+/);
  return [exe, args];
}

interface PendingPermission {
  resolve: (optionId: string | null) => void;
  options: { optionId: string; name: string; kind: string }[];
}

interface AcpSession {
  id: string; // our bridge session id (stable across respawns)
  engine: AcpEngine; // which ACP agent this session spawned (stable across respawns)
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
  private versions = new Map<AcpEngine, string | null>(); // probed CLI versions; missing key = not probed yet
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

  /** Probes each engine's version command once (cached) and reports per-engine availability. */
  async getAcpStatus(): Promise<{
    acpAvailable: boolean;
    geminiVersion: string | null;
    engines: Record<AcpEngine, { available: boolean; version: string | null }>;
  }> {
    const engines = {} as Record<AcpEngine, { available: boolean; version: string | null }>;
    for (const engine of Object.keys(ENGINE_CONFIGS) as AcpEngine[]) {
      const version = await this.probeVersion(engine);
      engines[engine] = { available: this.enabled && version !== null, version };
    }
    // Keep the legacy flat fields for callers that predate the per-engine map.
    return { acpAvailable: engines.gemini.available, geminiVersion: engines.gemini.version, engines };
  }

  private async probeVersion(engine: AcpEngine): Promise<string | null> {
    if (this.versions.has(engine)) return this.versions.get(engine)!;
    const [exe, args] = parseCommand(ENGINE_CONFIGS[engine].versionCommand);
    const version = await new Promise<string | null>(resolve => {
      execFile(exe, args, { timeout: 10_000, shell: process.platform === 'win32' }, (err, stdout) =>
        resolve(err ? null : stdout.trim()),
      );
    });
    this.versions.set(engine, version);
    return version;
  }

  /**
   * Streams one prompt turn through the Gemini CLI (ACP). Yields the same SSE event union
   * as the built-in harness, plus `session`, `permission-request` and `plan` events.
   */
  async *stream(
    message: string,
    sessionId?: string,
    profileContext?: string,
    engine: AcpEngine = 'gemini',
  ): AsyncGenerator<LocalAgentStreamEvent> {
    if (!this.enabled) {
      yield { type: 'error', error: 'LOCAL_AGENT_MODE is disabled on this server.' };
      return;
    }

    const queue = new AsyncEventQueue();
    queue.push({ type: 'status', message: `Arrancando motor agéntico (${engine})...` });

    const initPromise = (async () => {
      try {
        const session = await this.getOrCreateSession(sessionId, engine, (msg) => {
          queue.push({ type: 'status', message: msg });
        });

        if (session.queue) {
          queue.push({ type: 'error', error: 'Esta sesión ya tiene una solicitud en curso.' });
          return;
        }

        session.queue = queue;
        session.lastUsedAt = Date.now();

        // Emitimos el ID de la sesión al cliente
        queue.push({ type: 'session', sessionId: session.id });
        queue.push({ type: 'status', message: 'Conectando con el LLM...' });

        const prompt: any[] = [];
        if (profileContext && !session.contextSent) {
          prompt.push({
            type: 'resource',
            resource: { uri: 'context://agentic-profile', mimeType: 'text/markdown', text: profileContext },
          });
          session.contextSent = true;
        }
        prompt.push({ type: 'text', text: message });

        await session.connection
          .prompt({ sessionId: session.acpSessionId, prompt })
          .then((result: any) => queue.push({ type: 'finish', usage: { stopReason: result.stopReason } }))
          .catch((error: any) => queue.push({ type: 'error', error: String(error?.message ?? error) }))
          .finally(() => {
            session.queue = null;
            session.lastUsedAt = Date.now();
          });
      } catch (error) {
        queue.push({ type: 'error', error: `No se pudo iniciar el cliente ${engine} (ACP): ${error?.message ?? error}` });
      } finally {
        queue.close();
      }
    })();

    try {
      yield* queue.drain();
    } finally {
      await initPromise.catch(() => undefined);
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

  private async getOrCreateSession(
    sessionId?: string,
    engine: AcpEngine = 'gemini',
    onProgress?: (msg: string) => void,
  ): Promise<AcpSession> {
    const existing = sessionId ? this.sessions.get(sessionId) : undefined;
    if (existing && existing.process.exitCode === null) {
      onProgress?.('Reutilizando sesión activa...');
      return existing;
    }

    // Respawns must keep the engine the session was created with, regardless of the requested one.
    const resolvedEngine = existing?.engine ?? engine;
    const config = ENGINE_CONFIGS[resolvedEngine];

    onProgress?.('Cargando protocolo ACP...');
    const acp = await loadAcpSdk();
    const roots = this.fsTools.workspaceRoots;
    const cwd = roots[0];
    if (!cwd) throw new Error('No LOCAL_AGENT_WORKSPACE_ROOTS configured.');
    // spawn() with a non-existent cwd throws a misleading `spawn <exe> ENOENT` (blames the executable,
    // not the dir). Validate up front so the error names the real culprit — the workspace root.
    if (!fs.existsSync(cwd)) {
      throw new Error(`First LOCAL_AGENT_WORKSPACE_ROOTS path does not exist (used as cwd): ${cwd}`);
    }

    // Strip env vars that would push the CLI off personal auth or crash it (see EngineConfig.stripEnv).
    const env = { ...process.env };
    for (const key of config.stripEnv) delete env[key];

    const [exe, baseArgs] = parseCommand(process.env[config.commandEnv] || config.defaultCommand);
    // If exe is an absolute path (e.g. nvm's npx), prepend its dir to PATH so the CLI's `env node`
    // shebang resolves — the IDE's PATH often lacks the nvm bin dir, which causes `spawn ... ENOENT`.
    if (path.isAbsolute(exe)) {
      const binDir = path.dirname(exe);
      env.PATH = `${binDir}${path.delimiter}${env.PATH ?? ''}`;
    }
    const args = [...baseArgs];
    if (config.supportsIncludeDirs && roots.length > 1) {
      args.push('--include-directories', roots.slice(1).join(','));
    }
    
    onProgress?.(`Iniciando subproceso de la CLI (${resolvedEngine})...`);
    const child = spawn(exe, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    // A spawn failure (e.g. the CLI binary isn't on PATH) emits 'error' asynchronously. Without a
    // listener Node treats it as an unhandled 'error' event and crashes the whole process, so we
    // catch it here and surface it through the session stream instead.
    child.on('error', err => {
      const hint =
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? ` ('${exe}' not found on PATH — install it or set ${config.commandEnv} to its absolute path)`
          : '';
      this.logger.error(`Failed to spawn ${resolvedEngine} --acp${hint}: ${err.message}`);
      session.queue?.push({ type: 'error', error: `Could not start ${resolvedEngine} CLI: ${err.message}${hint}` });
      session.queue?.close();
    });
    child.stderr.on('data', (chunk: Buffer) => this.logger.debug(`[${resolvedEngine} --acp] ${chunk.toString().trim()}`));

    const session: AcpSession = {
      id: existing?.id ?? sessionId ?? randomUUID(),
      engine: resolvedEngine,
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
      this.logger.warn(`${resolvedEngine} --acp exited (code ${code}) for session ${session.id}`);
      session.queue?.push({ type: 'error', error: `${resolvedEngine} CLI process exited (code ${code}).` });
      session.queue?.close();
    });

    const clientCapabilities: any = {};
    if (resolvedEngine !== 'claude') {
      clientCapabilities.fs = { readTextFile: true, writeTextFile: true };
    }

    onProgress?.('Estableciendo conexión y handshake (ACP)...');
    const init = await session.connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities,
    });
    this.logger.log(`ACP initialized (protocol v${init.protocolVersion})`);

    if (session.acpSessionId && init.agentCapabilities?.loadSession) {
      onProgress?.(`Restaurando sesión agéntica: ${session.acpSessionId.slice(0, 8)}...`);
      await session.connection.loadSession({ sessionId: session.acpSessionId, cwd, mcpServers: [] });
    } else {
      onProgress?.('Creando nueva sesión en el motor agéntico...');
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
