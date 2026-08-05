import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { spawn, execFile, ChildProcessWithoutNullStreams } from 'child_process';
import { Readable, Writable } from 'stream';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { FilesystemToolsService } from './filesystem-tools.service';
import { LocalAgentStreamEvent } from './local-agent-chat.service';
import { normalizeTokenUsage } from './ai-usage.util';

// @agentclientprotocol/sdk is ESM-only; the project compiles to CommonJS, so a static
// import would become require() and fail. new Function keeps the dynamic import as-is.
const loadAcpSdk = new Function('return import("@agentclientprotocol/sdk")') as () => Promise<any>;

const IDLE_TTL_MS = 15 * 60 * 1000;
const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

/** ACP agents the bridge can spawn. The protocol is agent-agnostic — only the command differs. */
export type AcpEngine = 'gemini' | 'claude' | 'codex' | 'agy';
export type CodexReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface AcpRuntimeOptions {
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  /** Working directory for the spawned CLI session — the agent's workspace root
   * (resolved from the profile's workspaceId via ~/.control-markets/workspaces.json).
   * Falls back to the first LOCAL_AGENT_WORKSPACE_ROOTS when absent. */
  cwd?: string;
}

/**
 * Vendored ACP adapter for the Antigravity CLI. `agy` has no native ACP, so the adapter shells out
 * to its headless `--print --output-format stream-json` mode. It lives in the repo (instead of an
 * npm package) because it carries Control Markets patches — token usage in the prompt response
 * above all.
 *
 * The path is discovered by walking up from `__dirname` instead of being hardcoded: the build
 * webpack-bundles everything into `dist/main.js`, so `__dirname` is `dist/` at runtime but
 * `src/local-agent/` under ts-jest. Walking up covers both without a build-time constant.
 */
function resolveVendoredAgyAcp(): string {
  const relative = path.join('scripts', 'agy-acp', 'agy-acp.mjs');
  let dir = __dirname;
  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(dir, relative);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Not found: return the conventional location so the spawn error names a real path.
  return path.resolve(process.cwd(), relative);
}

const VENDORED_AGY_ACP = resolveVendoredAgyAcp();

interface EngineConfig {
  /** Env var that overrides the spawn command (executable + args, space-separated). */
  commandEnv: string;
  /** Default spawn command if the env var is unset. */
  defaultCommand: string;
  /** Whether the CLI accepts `--include-directories` for extra workspace roots (Gemini only). */
  supportsIncludeDirs: boolean;
  /** Whether the adapter accepts ACP `additionalDirectories` on session lifecycle requests. */
  supportsAdditionalDirectories?: boolean;
  /** Env vars stripped from the spawned process so the CLI uses personal auth / doesn't crash. */
  stripEnv: string[];
  /** Command used to probe availability/version (executable + args, space-separated). */
  versionCommand: string;
  /** Optional env var used to force this engine's model independently of the adapter default. */
  modelEnv?: string;
  /** Whether the model is selected via the standard ACP `session/set_config_option`. */
  selectsModelViaConfigOption?: boolean;
  /** Config option id this engine uses for reasoning effort, when it advertises one. */
  effortConfigId?: string;
  /** Optional env var with the default reasoning effort for `effortConfigId`. */
  effortEnv?: string;
}

const ENGINE_CONFIGS: Record<AcpEngine, EngineConfig> = {
  gemini: {
    commandEnv: 'LOCAL_AGENT_GEMINI_COMMAND',
    defaultCommand: 'gemini --acp',
    supportsIncludeDirs: true,
    // With these present (the backend sets them for Vertex AI) gemini switches from personal OAuth
    // to project-billed Code Assist and fails with 403 IAM_PERMISSION_DENIED.
    stripEnv: ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT_ID', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_CLOUD_LOCATION'],
    versionCommand: 'gemini --version',
  },
  claude: {
    // Official ACP adapter for the Claude Agent SDK. Pin the version so local-agent behavior
    // cannot change underneath a running deployment when npm's latest tag advances.
    commandEnv: 'LOCAL_AGENT_CLAUDE_COMMAND',
    defaultCommand: 'npx -y @agentclientprotocol/claude-agent-acp@0.59.0',
    supportsIncludeDirs: false,
    selectsModelViaConfigOption: true,
    // CLAUDECODE/CLAUDE_CODE_* are set when the backend itself runs under Claude Code; the adapter
    // then refuses to launch ("cannot be launched inside another Claude Code session").
    stripEnv: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT'],
    versionCommand: 'npx -y @agentclientprotocol/claude-agent-acp@0.59.0 --cli --version',
    modelEnv: 'LOCAL_AGENT_CLAUDE_MODEL',
  },
  codex: {
    // The official ACP adapter starts `codex app-server` and translates it to ACP.
    commandEnv: 'LOCAL_AGENT_CODEX_COMMAND',
    defaultCommand: 'npx -y @agentclientprotocol/codex-acp@latest',
    supportsIncludeDirs: false,
    stripEnv: [],
    versionCommand: 'codex --version',
    modelEnv: 'LOCAL_AGENT_CODEX_MODEL',
  },
  agy: {
    // Runs the in-repo adapter with the backend's own Node, so there is nothing to install and
    // nothing to pin: the code that serves a turn is the code committed next to this file.
    // LOCAL_AGENT_AGY_COMMAND still overrides it (e.g. `npx -y agy-acp-bridge@0.2.2`).
    commandEnv: 'LOCAL_AGENT_AGY_COMMAND',
    defaultCommand: `${process.execPath} ${VENDORED_AGY_ACP}`,
    supportsIncludeDirs: false,
    supportsAdditionalDirectories: true,
    stripEnv: [],
    // Probes the CLI, not the adapter: the adapter ships with the repo and is always present,
    // while `agy` is the host dependency that can actually be missing.
    versionCommand: 'agy --version',
    modelEnv: 'LOCAL_AGENT_AGY_MODEL',
    selectsModelViaConfigOption: true,
    effortConfigId: 'effort',
    effortEnv: 'LOCAL_AGENT_AGY_REASONING_EFFORT',
  },
};

/** Splits a "exe arg1 arg2" command string into [executable, ...args] (whitespace-separated). */
function parseCommand(command: string): [string, string[]] {
  const [exe, ...args] = command.trim().split(/\s+/);
  return [exe, args];
}

/**
 * Turns a bare command name into an absolute path when it can be found.
 *
 * The backend is often launched from an IDE whose PATH omits `~/.local/bin` — where the Antigravity
 * installer puts `agy`. Without this, the version probe silently reports the engine as unavailable
 * and the spawn fails with a misleading ENOENT.
 */
function resolveExecutable(exe: string): string {
  if (exe.includes(path.sep)) return exe;
  const searchDirs = [...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean), path.join(os.homedir(), '.local', 'bin')];
  for (const dir of searchDirs) {
    const candidate = path.join(dir, exe);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return exe;
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
  runtimeOptions: AcpRuntimeOptions;
  /** Model the adapter reports as current (`configOptions[id=model].currentValue`) — what will run. */
  resolvedModel?: string;
  /** Reasoning effort the adapter reports as current, when it advertises the option. */
  resolvedEffort?: string;
  /** Exact USD cost attributable to the active turn, derived from `usage_update` increments. */
  turnCostUsd?: number;
  /**
   * Last cumulative session cost reported by the agent. ACP defines `usage_update.cost` as the
   * *cumulative* session cost, so each notification must be diffed against this to obtain the
   * increment. Lives on the session (not the turn) because the counter spans the whole session.
   */
  reportedCumulativeCostUsd?: number;
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
      execFile(resolveExecutable(exe), args, { timeout: 10_000, shell: process.platform === 'win32' }, (err, stdout) => resolve(err ? null : stdout.trim()));
    });
    this.versions.set(engine, version);
    return version;
  }

  /**
   * Streams one prompt turn through the Gemini CLI (ACP). Yields the same SSE event union
   * as the built-in harness, plus `session`, `permission-request` and `plan` events.
   */
  async *stream(message: string, sessionId?: string, profileContext?: string, engine: AcpEngine = 'gemini', runtimeOptions: AcpRuntimeOptions = {}): AsyncGenerator<LocalAgentStreamEvent> {
    if (!this.enabled) {
      yield { type: 'error', error: 'LOCAL_AGENT_MODE is disabled on this server.' };
      return;
    }

    const queue = new AsyncEventQueue();
    queue.push({ type: 'status', message: `Arrancando motor agéntico (${engine})...` });

    const initPromise = (async () => {
      try {
        const session = await this.getOrCreateSession(sessionId, engine, runtimeOptions, msg => {
          queue.push({ type: 'status', message: msg });
        });

        if (session.queue) {
          queue.push({ type: 'error', error: 'Esta sesión ya tiene una solicitud en curso.' });
          return;
        }

        session.queue = queue;
        session.lastUsedAt = Date.now();
        session.turnCostUsd = undefined;

        // Emitimos el ID de la sesión al cliente. `sessionId` es el id del bridge y el cliente lo
        // reenvía para reanudar, así que no puede cambiar; `cliSessionId` va aparte porque es el
        // único que permite correlacionar la conversación con el log de sesión del CLI en disco.
        // `model`/`reasoningEffort` are what the adapter negotiated, not what the caller asked for.
        // The UI shows these so "esfuerzo default" stops being an unanswerable question.
        queue.push({
          type: 'session',
          sessionId: session.id,
          cliSessionId: session.acpSessionId || undefined,
          model: session.resolvedModel,
          reasoningEffort: session.resolvedEffort,
        });
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
          .then((result: any) => {
            const usage = normalizeTokenUsage(result.usage, {
              provider: engine === 'gemini' ? 'google' : engine === 'claude' ? 'anthropic' : engine,
              // The session's model wins: it holds the adapter default when the caller sent none.
              model: session.runtimeOptions.model ?? runtimeOptions.model,
              source: 'acp',
            });
            if (usage && session.turnCostUsd != null) {
              // Unlike table-based estimates, this is the adapter's exact Claude Agent SDK
              // `total_cost_usd`, reduced to this turn's increment. Keep the established field
              // name for API/UI compatibility.
              usage.estimatedCostUsd = session.turnCostUsd;
              usage.pricingVersion = 'reported-by-claude-agent-sdk';
              // Raw cumulative kept alongside so the increments stay auditable against it.
              if (session.reportedCumulativeCostUsd != null) usage.reportedCumulativeCostUsd = session.reportedCumulativeCostUsd;
            }
            if (usage) {
              // Already-probed value only (the map is populated by the status endpoint); never
              // spawn a version probe on the turn's hot path.
              const engineVersion = this.versions.get(session.engine);
              if (engineVersion) usage.engineVersion = engineVersion;
            }
            queue.push({
              type: 'finish',
              usage,
            });
          })
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

  private async getOrCreateSession(sessionId?: string, engine: AcpEngine = 'gemini', runtimeOptions: AcpRuntimeOptions = {}, onProgress?: (msg: string) => void): Promise<AcpSession> {
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
    // A profile bound to a workspace runs in that workspace's root; otherwise fall back
    // to the first configured global root (legacy behavior).
    const cwd = runtimeOptions.cwd || roots[0];
    if (!cwd) throw new Error('No LOCAL_AGENT_WORKSPACE_ROOTS configured.');
    // spawn() with a non-existent cwd throws a misleading `spawn <exe> ENOENT` (blames the executable,
    // not the dir). Validate up front so the error names the real culprit — the workspace root.
    if (!fs.existsSync(cwd)) {
      throw new Error(`Workspace root used as cwd does not exist: ${cwd}`);
    }

    // Strip env vars that would push the CLI off personal auth or crash it (see EngineConfig.stripEnv).
    const env = { ...process.env };
    for (const key of config.stripEnv) delete env[key];

    if (resolvedEngine === 'claude') {
      // The Zed adapter wraps the Claude Agent SDK, which honors ANTHROPIC_MODEL
      // (aliases like 'sonnet'/'opus'/'haiku' or full model ids). The env is fixed at
      // spawn time, so changing model requires a new session — the frontend resets it.
      const claudeModel = runtimeOptions.model?.trim() || process.env.LOCAL_AGENT_CLAUDE_MODEL?.trim();
      if (claudeModel) env.ANTHROPIC_MODEL = claudeModel;
    }

    if (resolvedEngine === 'codex') {
      // Force the adapter to use the user's installed CLI. The older Zed adapter embedded its own
      // Codex runtime, which could lag behind and reject newer subscription models such as Terra.
      env.CODEX_PATH = process.env.LOCAL_AGENT_CODEX_PATH?.trim() || 'codex';
      const configuredModel = runtimeOptions.model?.trim() || process.env.LOCAL_AGENT_CODEX_MODEL?.trim();
      const configuredReasoningEffort = runtimeOptions.reasoningEffort || process.env.LOCAL_AGENT_CODEX_REASONING_EFFORT?.trim();
      if (configuredModel || configuredReasoningEffort) {
        let codexConfig: Record<string, unknown> = {};
        if (process.env.CODEX_CONFIG) {
          try {
            codexConfig = JSON.parse(process.env.CODEX_CONFIG);
          } catch {
            this.logger.warn('Ignoring invalid CODEX_CONFIG JSON while configuring Codex ACP.');
          }
        }
        env.CODEX_CONFIG = JSON.stringify({
          ...codexConfig,
          ...(configuredModel ? { model: configuredModel } : {}),
          ...(configuredReasoningEffort ? { model_reasoning_effort: configuredReasoningEffort } : {}),
        });
      }
    }

    const [rawExe, baseArgs] = parseCommand(process.env[config.commandEnv] || config.defaultCommand);
    const exe = resolveExecutable(rawExe);
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
      const hint = (err as NodeJS.ErrnoException).code === 'ENOENT' ? ` ('${exe}' not found on PATH — install it or set ${config.commandEnv} to its absolute path)` : '';
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
      runtimeOptions: existing?.runtimeOptions ?? runtimeOptions,
      turnCostUsd: undefined,
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
    // Claude, Codex and agy use their own native filesystem tooling. Advertising ACP fs would
    // duplicate tools and can make the model choose the wrong implementation — and for agy it
    // would be a lie: its headless mode has no channel to delegate IO back to us, so the CLI
    // writes to disk directly and FilesystemToolsService's deny-list never sees those paths.
    if (resolvedEngine === 'gemini') {
      clientCapabilities.fs = { readTextFile: true, writeTextFile: true };
    }

    onProgress?.('Estableciendo conexión y handshake (ACP)...');
    const init = await session.connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities,
    });
    this.logger.log(`ACP initialized (protocol v${init.protocolVersion})`);

    // Extra workspace roots the adapter should mount alongside `cwd`. `supportsIncludeDirs` is the
    // Gemini-only CLI flag path (handled at spawn time); this is the protocol-level equivalent.
    // Stale entries in LOCAL_AGENT_WORKSPACE_ROOTS are dropped rather than forwarded: a missing
    // directory makes the CLI reject the whole invocation, taking the valid roots down with it.
    const additionalDirectories = config.supportsAdditionalDirectories ? roots.filter(root => root !== cwd && fs.existsSync(root)) : undefined;

    let configOptions: any[] | undefined;
    // Two ways to pick a session back up: `session/load` (legacy flag) and `session/resume` (the
    // current spec, advertised under sessionCapabilities). Adapters implement one or the other —
    // the vendored agy adapter implements resume — and checking only the legacy flag would
    // silently mint a new session after every respawn, losing the CLI-side conversation.
    const canResume = Boolean(init.agentCapabilities?.sessionCapabilities?.resume);
    if (session.acpSessionId && init.agentCapabilities?.loadSession) {
      onProgress?.(`Restaurando sesión agéntica: ${session.acpSessionId.slice(0, 8)}...`);
      const loaded = await session.connection.loadSession({ sessionId: session.acpSessionId, cwd, mcpServers: [] });
      configOptions = loaded?.configOptions;
    } else if (session.acpSessionId && canResume) {
      onProgress?.(`Reanudando sesión agéntica: ${session.acpSessionId.slice(0, 8)}...`);
      const resumed = await session.connection.resumeSession({ sessionId: session.acpSessionId, cwd, mcpServers: [], additionalDirectories });
      configOptions = resumed?.configOptions;
    } else {
      onProgress?.('Creando nueva sesión en el motor agéntico...');
      const created = await session.connection.newSession({ cwd, mcpServers: [], additionalDirectories });
      session.acpSessionId = created.sessionId;
      configOptions = created?.configOptions;
    }

    if (config.selectsModelViaConfigOption) {
      const desiredModel = session.runtimeOptions.model?.trim() || (config.modelEnv ? process.env[config.modelEnv]?.trim() : undefined);
      configOptions = (await this.applySessionConfigOption(session, configOptions, 'model', desiredModel, onProgress)) ?? configOptions;
    }
    if (config.effortConfigId) {
      const desiredEffort = session.runtimeOptions.reasoningEffort?.trim() || (config.effortEnv ? process.env[config.effortEnv]?.trim() : undefined);
      configOptions = (await this.applySessionConfigOption(session, configOptions, config.effortConfigId, desiredEffort, onProgress)) ?? configOptions;
    }

    // What the adapter says it will actually use, after negotiation. This is the only honest
    // answer to "which model/effort is running?": leaving the selector on "default" means the
    // adapter picks, and requesting a value it does not advertise means it keeps its own.
    // Reported to the client in the `session` event and attached to the turn's token usage.
    const readOption = (id: string) => {
      const value = configOptions?.find(option => option?.id === id)?.currentValue;
      return typeof value === 'string' ? value : undefined;
    };
    session.resolvedModel = readOption('model');
    session.resolvedEffort = config.effortConfigId ? readOption(config.effortConfigId) : undefined;
    // Adapters have their own default model, so a turn where the caller picked none still needs a
    // model recorded against its token usage — otherwise the history cannot be priced or audited.
    if (!session.runtimeOptions.model && session.resolvedModel) {
      session.runtimeOptions.model = session.resolvedModel;
    }

    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Applies one session setting through the standard ACP `session/set_config_option`.
   *
   * Adapters advertise their valid values in `configOptions` and reject anything outside that
   * list, so the requested value is resolved against what this session actually offers (exact
   * match first, then a substring match against value/name to tolerate aliases such as `opus`
   * for `claude-opus-4-6`). Returns the adapter's refreshed `configOptions` when it sends them,
   * which matters for `model` on agy: changing the model resets the available effort values.
   */
  private async applySessionConfigOption(
    session: AcpSession,
    configOptions: any[] | undefined,
    configId: string,
    requestedValue?: string,
    onProgress?: (msg: string) => void
  ): Promise<any[] | undefined> {
    const desired = requestedValue?.trim();
    if (!desired) return undefined;
    const norm = (value: unknown) => String(value ?? '').toLowerCase();
    const option = configOptions?.find(candidate => candidate?.id === configId);
    // Some adapters group their options (`{ name, options: [...] }`); flatten one level.
    const available: { value: string; name?: string }[] = (option?.options ?? []).flatMap((entry: any) => (Array.isArray(entry?.options) ? entry.options : [entry]));
    const match = available.find(entry => norm(entry.value) === norm(desired)) ?? available.find(entry => norm(entry.value).includes(norm(desired)) || norm(entry.name).includes(norm(desired)));
    if (!option || !match) {
      this.logger.warn(
        `ACP session ${session.id}: ${configId} '${desired}' is not advertised by the adapter ` +
          `(available: ${available.map(entry => entry.value).join(', ') || 'none'}); keeping its default.`
      );
      return undefined;
    }
    if (option.currentValue === match.value) return undefined;
    try {
      onProgress?.(`Configurando ${configId}: ${match.value}...`);
      const updated = await session.connection.setSessionConfigOption({
        sessionId: session.acpSessionId,
        configId,
        value: match.value,
      });
      this.logger.log(`ACP session ${session.id}: ${configId} set to ${match.value}`);
      return updated?.configOptions;
    } catch (error) {
      this.logger.warn(`ACP session ${session.id}: could not set ${configId} '${desired}': ${error?.message ?? error}`);
      return undefined;
    }
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
      case 'usage_update': {
        // ACP defines `usage_update.cost` as the CUMULATIVE session cost, not the turn's cost
        // (`UsageUpdate.cost` in @agentclientprotocol/sdk: "Cumulative session cost"). Claude
        // sources it from the Agent SDK's `total_cost_usd`, which keeps growing across turns, so
        // the amount must be diffed against the previous reading to get this turn's increment.
        // Storing the raw amount would make every turn report the session total to date.
        const amount = Number(update.cost?.amount);
        if (update.cost?.currency !== 'USD' || !Number.isFinite(amount)) return null;

        const previous = session.reportedCumulativeCostUsd ?? 0;
        // A value below the previous reading means the agent restarted its counter (respawn or
        // fresh session), so the amount is itself the increment rather than a running total.
        const increment = amount < previous ? amount : amount - previous;
        session.reportedCumulativeCostUsd = amount;

        // Autonomous background activity carries an origin marker: its increment still advances
        // the cumulative counter (so it never leaks into the next user turn) but is not billed to
        // the user's active turn, whose token totals come from PromptResponse.usage.
        const origin = update._meta?.['_claude/origin'];
        if (!origin) session.turnCostUsd = (session.turnCostUsd ?? 0) + increment;
        return null;
      }
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
