import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { McpScope, resolveAgentSessionScopes, toolNamesForScopes } from '../mcp/mcp-scopes';

const logger = new Logger('AcpMcpWiring');

/**
 * How a given ACP engine can be told about an MCP server. Not a preference — a fact about the CLI.
 *
 * - `acp-http`: the adapter honours the `mcpServers` argument of `session/new` and understands the
 *   protocol's `type: "http"` descriptor, headers included. Claude's official adapter does.
 * - `agy-config-stdio`: the CLI ignores ACP's `mcpServers` entirely and reads its own global config
 *   file instead. Everything below about `agy` follows from that one fact.
 * - `undefined`: no supported path. The session opens without our tools and says so.
 */
export type McpTransportKind = 'acp-http' | 'agy-config-stdio';

/** What a session needs to know to reach `/mcp`, decided before the session exists. */
export interface McpWiringPlan {
  transport: McpTransportKind;
  /** Absolute URL of our own `/mcp`, normally loopback. */
  url: string;
  scopes: McpScope[];
  /** Names the tools this session will see, so the context index can print them before connecting. */
  toolNames: string[];
  /** The single organization this session's credential may reach. Also what `bin/cm` sends as `x-org-id`. */
  orgId: string;
  /**
   * Whether the tools can actually be delivered to this engine *in this environment* — not whether
   * we would like to deliver them. `false` empties `toolNames`, which is the whole point: task 28
   * exists because the index named `cm_read` for an `agy` session whose config file could not be
   * written, and nothing ever contrasted the promise with the fact.
   */
  toolsReachable: boolean;
}

/** The server name the agent sees its Control Markets tools grouped under. */
export const CM_MCP_SERVER_NAME = 'control-markets';

/**
 * Where the agent should call us.
 *
 * **Loopback, not the public hostname.** The traffic is born and dies inside the same container: the
 * backend spawns a CLI, the CLI (or its MCP child) calls back into the backend. Routing that through
 * `local-back.control.markets` would send every `cm_read` out to Cloudflare and back for no reason,
 * add its timeouts to a tool call, and — worse — make an internal credential travel a public path.
 */
export function resolveMcpUrl(): string {
  const configured = process.env.AGENT_MCP_URL?.trim();
  if (configured) return configured;
  return `http://127.0.0.1:${process.env.PORT?.trim() || 8121}/mcp`;
}

/** `AGENT_MCP_ENABLED=false` turns the whole thing off without a redeploy of anything else. */
export function isMcpWiringEnabled(): boolean {
  return process.env.AGENT_MCP_ENABLED?.trim().toLowerCase() !== 'false';
}

/**
 * Decides whether a session gets our tools, and which ones — **without side effects**.
 *
 * Pure on purpose: `describeRuntime` calls it to render the context index *before* the session
 * exists (the index has to name the tools in the prompt that opens the session), and
 * `getOrCreateSession` calls it again when it actually mints a token. Two callers, one predicate, no
 * chance of the index promising `cm_read` to a session that will not have it.
 */
export function planMcpWiring(transport: McpTransportKind | undefined, orgId?: string): McpWiringPlan | null {
  if (!transport || !isMcpWiringEnabled()) return null;
  // No organization, no tools. Every tool resolves its tenant from the token, so a session that
  // cannot say which organization it belongs to has nothing safe to be given.
  if (!orgId) return null;
  const scopes = resolveAgentSessionScopes();
  // The prediction is contrasted here, once, for both callers. `agy` is the only engine whose
  // delivery can fail before the session exists (it needs a writable, parseable config file), so it
  // is the only one that gets probed — read-only, never registering anything as a side effect.
  const toolsReachable = transport === 'agy-config-stdio' ? canWireAgyMcpConfig() : true;
  return {
    transport,
    url: resolveMcpUrl(),
    scopes,
    toolNames: toolsReachable ? toolNamesForScopes(scopes) : [],
    orgId,
    toolsReachable,
  };
}

/**
 * Can `ensureAgyMcpConfig` succeed here? Answered without writing anything.
 *
 * `describeRuntime` renders the context index before the session exists, so this is the only way the
 * index can avoid naming tools an `agy` session will not get. The three ways delivery fails: the
 * shim is not in the image, the config file holds something we refuse to overwrite, or its directory
 * cannot be written. An absent or empty file is *not* a failure — that is the normal first run, and
 * treating an empty file as malformed was the root cause of the 2026-08-20 homelab incident.
 */
export function canWireAgyMcpConfig(shimPath = resolveAgyShimPath(), configPath = resolveAgyMcpConfigPath()): boolean {
  if (!fs.existsSync(shimPath)) return false;
  return readAgyMcpConfig(configPath) !== null;
}

/**
 * The config file as an object, or `null` when it holds something we must not clobber.
 *
 * Absent → `{}`. Empty or whitespace → `{}`: a zero-byte file is what a bind mount, a `touch` or an
 * interrupted write leaves behind, and it contains no work of anybody's to protect. Only actual
 * malformed JSON returns `null`, because that *is* somebody's hand-edit in progress.
 */
function readAgyMcpConfig(configPath: string): Record<string, any> | null {
  try {
    if (!fs.existsSync(configPath)) return {};
    const raw = fs.readFileSync(configPath, 'utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw) ?? {};
  } catch {
    return null;
  }
}

/**
 * The ACP `mcpServers` descriptor — the standard path, used by every engine except `agy`.
 *
 * The token rides in a header rather than the URL because a URL ends up in logs, in the adapter's
 * session state and in error messages; a header does not.
 */
export function buildAcpMcpServers(plan: McpWiringPlan, token: string): any[] {
  return [
    {
      type: 'http',
      name: CM_MCP_SERVER_NAME,
      url: plan.url,
      headers: [{ name: 'Authorization', value: `Bearer ${token}` }],
    },
  ];
}

/**
 * Walks up from `__dirname` looking for a file under the repo, the same trick the vendored `agy`
 * adapter path uses: webpack collapses the build into `dist/main.js`, so `__dirname` differs between
 * a built server and ts-jest, and a build-time constant would be wrong in one of them.
 */
export function resolveRepoFile(relative: string): string {
  let dir = __dirname;
  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(dir, relative);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd(), relative);
}

/** Absolute path of the stdio↔HTTP shim `agy` spawns. */
export function resolveAgyShimPath(): string {
  return resolveRepoFile(path.join('scripts', 'agy-acp', 'cm-mcp-stdio.mjs'));
}

/**
 * How this runtime should type the universal reader — or `null` when it is not installed here.
 *
 * Returned as the *command a reader would type*, not as a boolean: `cm` when `bin/` is on the
 * `PATH`, the absolute path when it is not. Printing a bare `cm` where the shell cannot resolve it
 * would be the same class of lie the whole context-hint machinery exists to prevent — a plausible
 * instruction that fails on execution.
 *
 * This matters because the CLI is the *only* door left for an engine that has a shell and no MCP
 * tools, which is exactly the state an `agy` session lands in when its config-file wiring fails.
 * Measured, never assumed: `existsSync` decides, so an image built without `bin/` says so.
 */
export function resolveCmCliCommand(): string | null {
  const cmPath = resolveRepoFile(path.join('bin', 'cm'));
  if (!fs.existsSync(cmPath)) return null;
  return isOnPath(cmPath) ? path.basename(cmPath) : cmPath;
}

/** Whether the directory holding `file` is one of the `PATH` entries of this process. */
function isOnPath(file: string): boolean {
  return (process.env.PATH ?? '').split(path.delimiter).includes(path.dirname(file));
}

/** Where the Antigravity CLI reads its MCP servers from. Verified on agy (macOS, 2026-08-18). */
export function resolveAgyMcpConfigPath(): string {
  const override = process.env.AGY_MCP_CONFIG_PATH?.trim();
  if (override) return override;
  return path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
}

/**
 * Registers our shim in `agy`'s global MCP config, preserving whatever else lives there.
 *
 * ## Why a file at all, when every other engine takes a descriptor
 *
 * Measured on 2026-08-18 against the installed CLI: `agy` has **no** command-line flag for MCP, its
 * vendored ACP adapter never mentions MCP, and its own configuration schema has no place for a
 * header. Its two transports are a local `command` and a bare `serverUrl` with no auth. So the
 * standard path is unavailable and the credential cannot travel the way it does for Claude.
 *
 * ## Why that is not the security problem it looks like
 *
 * **No token is written here.** The entry is a static `command`; the credential reaches the shim
 * through the environment, and the environment is per-process. The measurement that makes this work:
 * `agy` spawns the configured MCP server as a **child of the `agy --print` process it runs for that
 * turn**, which inherits the environment the bridge gave the adapter. Two concurrent sessions
 * therefore share this one config file and still get different tokens, different organizations and
 * different scopes — the file names the program, the process supplies the identity.
 *
 * Consequences worth stating plainly: the config is global to the host, so on a developer's laptop
 * this touches a file they also edit by hand. It is merged key by key and written atomically, never
 * rewritten wholesale, and it is skipped entirely when the entry is already correct.
 */
export function ensureAgyMcpConfig(shimPath = resolveAgyShimPath(), configPath = resolveAgyMcpConfigPath()): boolean {
  const desired = {
    command: process.execPath,
    args: [shimPath],
  };

  const current = readAgyMcpConfig(configPath);
  if (current === null) {
    // A malformed file is somebody's hand-edit in progress. Overwriting it would delete their work
    // and their other servers; the honest outcome is to leave agy without our tools and say why.
    // An *empty* file is not that case and never reaches here — see `readAgyMcpConfig`.
    logger.error(`agy MCP config at ${configPath} is not valid JSON — leaving it alone; agy sessions will run without Control Markets tools.`);
    return false;
  }

  const servers = current.mcpServers && typeof current.mcpServers === 'object' ? current.mcpServers : {};
  const existing = servers[CM_MCP_SERVER_NAME];
  if (existing?.command === desired.command && JSON.stringify(existing?.args) === JSON.stringify(desired.args)) {
    return true;
  }

  const next = { ...current, mcpServers: { ...servers, [CM_MCP_SERVER_NAME]: desired } };
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const tmp = `${configPath}.cm-${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    // Keep whoever owned the file owning it. In the homelab the container mounts the host user's
    // `~/.gemini`, and the backend runs as root: a plain atomic replace would hand that person's
    // own config to root with mode 600 and lock them out of the file their CLI needs to write.
    // Best effort — a filesystem that refuses the chown is not a reason to skip the registration.
    try {
      const previous = fs.statSync(configPath);
      fs.chmodSync(tmp, previous.mode & 0o777);
      if (process.getuid?.() === 0) fs.chownSync(tmp, previous.uid, previous.gid);
    } catch {}
    fs.renameSync(tmp, configPath);
    logger.log(`Registered '${CM_MCP_SERVER_NAME}' in ${configPath} -> ${shimPath}`);
    return true;
  } catch (error: any) {
    logger.error(`Could not write agy MCP config at ${configPath}: ${error.message}`);
    return false;
  }
}

/** Environment the `agy` adapter — and through it `agy`, and through it the shim — inherits. */
export function agyMcpEnv(plan: McpWiringPlan, token: string): Record<string, string> {
  // `CM_ORG_ID` is for `bin/cm`, not for MCP: every MCP tool resolves its tenant from the token and
  // ignores this. It matters when the CLI ends up on a credential that carries no organization of
  // its own (the master token of a container), which used to turn a read into a 404 against the
  // synthetic `system_root` tenant instead of an answer.
  return { CM_MCP_URL: plan.url, CM_MCP_TOKEN: token, CM_ORG_ID: plan.orgId };
}

/**
 * A read-only picture of the wiring, so a deployed backend can be interrogated with one `curl`
 * instead of by inference from logs.
 *
 * Every field is either a pure function of the environment or a `stat`/read of a file: calling this
 * never registers the shim, never mints a token and never touches `agy`'s config. That matters
 * because it is the endpoint an operator hits *before* deciding whether the deployment is wired,
 * and a diagnostic that fixes what it measures cannot answer that question.
 *
 * Consequence worth stating: `agy.registered` is `false` until the first `agy` session opens, since
 * `ensureAgyMcpConfig` runs at session open. False before the first session is the correct reading,
 * not a fault.
 */
export interface McpWiringDiagnostics {
  enabled: boolean;
  url: string;
  scopes: McpScope[];
  toolNames: string[];
  /** Per engine, how it can be told about MCP — or `none` when the CLI offers no path. */
  transports: Record<string, McpTransportKind | 'none'>;
  agy: {
    configPath: string;
    configExists: boolean;
    /** `false` means a malformed file, which is the one case where sessions run without our tools. */
    configReadable: boolean;
    /** Our entry is present *and* points at this process' Node and this build's shim. */
    registered: boolean;
    shimPath: string;
    shimExists: boolean;
  };
  /** `bin/cm`, the fallback for an engine that has a shell but none of our tools. */
  cmCli: { path: string; exists: boolean; onPath: boolean };
}

export function describeMcpWiring(transports: Record<string, McpTransportKind | undefined>): McpWiringDiagnostics {
  const scopes = resolveAgentSessionScopes();
  const configPath = resolveAgyMcpConfigPath();
  const shimPath = resolveAgyShimPath();
  const cmPath = resolveRepoFile(path.join('bin', 'cm'));

  const configExists = fs.existsSync(configPath);
  const parsed = readAgyMcpConfig(configPath);
  const configReadable = parsed !== null;
  const entry = parsed?.mcpServers?.[CM_MCP_SERVER_NAME];
  const registered = entry?.command === process.execPath && JSON.stringify(entry?.args) === JSON.stringify([shimPath]);

  return {
    enabled: isMcpWiringEnabled(),
    url: resolveMcpUrl(),
    scopes,
    toolNames: toolNamesForScopes(scopes),
    transports: Object.fromEntries(Object.entries(transports).map(([engine, kind]) => [engine, kind ?? 'none'])),
    agy: { configPath, configExists, configReadable, registered, shimPath, shimExists: fs.existsSync(shimPath) },
    cmCli: { path: cmPath, exists: fs.existsSync(cmPath), onPath: isOnPath(cmPath) },
  };
}
