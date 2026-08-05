#!/usr/bin/env node
/**
 * agy-acp (Control Markets fork) — ACP adapter for the Google Antigravity CLI (`agy`).
 *
 * Vendored from https://github.com/maojindao55/agy-acp @ v0.2.2 (Apache-2.0) and patched for
 * Control Markets. `agy` has no native ACP; this process speaks ACP on stdio and translates each
 * `session/prompt` into one headless `agy --print --output-format stream-json` invocation,
 * mapping its NDJSON events to ACP `session/update` notifications.
 *
 * Why a local copy instead of `npx agy-acp-bridge`: the upstream package does not report token
 * usage in the `session/prompt` response, which the backend needs for `agentic_heartbeat_runs`
 * and the token chip in the UI. See wiki `02-references/09-agentic-profile-(borges)/`.
 *
 * Control Markets patches (all marked `CM-Pn` below):
 *   CM-P1  Token usage returned in the `session/prompt` response (ACP `Usage`).
 *   CM-P2  Silent-failure detection: headless auto-denials report SUCCESS with an empty response.
 *   CM-P3  `agy` binary resolution (PATH scan + `AGY_ACP_AGY_BIN` + ~/.local/bin fallback).
 *   CM-P4  `--print-timeout` aligned with the heartbeat hard timeout (`AGY_ACP_PRINT_TIMEOUT`).
 *   CM-P5  Default model/effort seeded from env (`AGY_ACP_MODEL` / `AGY_ACP_EFFORT`).
 *
 * Runs on the backend's own `@agentclientprotocol/sdk` (resolved from ../../node_modules), so it
 * needs no build step and no separate install.
 */
import { agent, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { existsSync, accessSync, constants as fsConstants } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import crypto from 'node:crypto';

const VERSION = '0.2.2-cm.1';

if (process.argv.includes('--version') || process.argv.includes('-v') || process.argv.includes('version')) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

// Keep stdout exclusively for the JSON-RPC pipe; debug logs go to stderr only when requested.
// A stray console.log would corrupt the protocol, so console.log itself is redirected.
const DEBUG = Boolean(process.env.DEBUG || process.env.AGY_ACP_DEBUG);
const logDebug = (...args) => {
  if (DEBUG) console.error('[agy-acp]', ...args);
};
const logError = (...args) => {
  console.error('[agy-acp]', ...args);
};
console.log = logDebug;

const STATE_FILE = process.env.AGY_ACP_STATE_FILE || path.join(os.homedir(), '.agy-acp-state.json');

// --- CM-P3: agy binary resolution -------------------------------------------
// The backend is often spawned from an IDE whose PATH lacks ~/.local/bin, where the Antigravity
// installer puts `agy`. Resolving here (instead of relying on spawn's PATH lookup) turns a
// confusing "spawn agy ENOENT" mid-turn into a deterministic absolute path at startup.

function resolveAgyBin() {
  const configured = process.env.AGY_ACP_AGY_BIN?.trim();
  if (configured) return configured;
  const candidates = [
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, 'agy')),
    path.join(os.homedir(), '.local', 'bin', 'agy'),
  ];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return 'agy'; // let spawn fail with ENOENT and report the hint
}

const AGY_BIN = resolveAgyBin();
logDebug('using agy binary:', AGY_BIN);

// --- Models ----------------------------------------------------------------
// agy exposes models via `agy models`. Some embed reasoning effort in the id
// (gemini-*-high/medium/low), others accept a separate `--effort` flag, and a
// few (Claude) reject effort entirely. Verified against agy:
//   - gemini-*, gpt-oss-120b: `--model <base> --effort <e>` works; base REQUIRES --effort.
//   - claude-*: no effort; `--model <base>` only.
//   - a full effort-baked id CONFLICTS with `--effort`, so we always split.

const EFFORTS = ['low', 'medium', 'high'];

const MODELS = [
  { base: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', contextWindow: 1_000_000, supportsEffort: true, defaultEffort: 'high' },
  { base: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', contextWindow: 1_000_000, supportsEffort: true, defaultEffort: 'high' },
  { base: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', contextWindow: 2_000_000, supportsEffort: true, defaultEffort: 'high' },
  { base: 'gpt-oss-120b', name: 'GPT-OSS 120B', contextWindow: 128_000, supportsEffort: true, defaultEffort: 'medium' },
  { base: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 200_000, supportsEffort: false, defaultEffort: null },
  { base: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)', contextWindow: 200_000, supportsEffort: false, defaultEffort: null },
];

const DEFAULT_MODEL_BASE = 'gemini-3.6-flash';

function findModel(base) {
  return MODELS.find(m => m.base === base);
}

function contextWindowFor(base) {
  return findModel(base)?.contextWindow ?? 200_000;
}

// --- Backward compatibility (agy-acp <= 0.1.x) -----------------------------
// Older versions used display-name model ids such as "Gemini 3.6 Flash (High)"
// (effort baked into the name) and stored them under `modelId`.

const LEGACY_MODEL_MAP = {
  'Gemini 3.6 Flash (High)': { base: 'gemini-3.6-flash', effort: 'high' },
  'Gemini 3.6 Flash (Medium)': { base: 'gemini-3.6-flash', effort: 'medium' },
  'Gemini 3.6 Flash (Low)': { base: 'gemini-3.6-flash', effort: 'low' },
  'Gemini 3.5 Flash (High)': { base: 'gemini-3.5-flash', effort: 'high' },
  'Gemini 3.5 Flash (Medium)': { base: 'gemini-3.5-flash', effort: 'medium' },
  'Gemini 3.5 Flash (Low)': { base: 'gemini-3.5-flash', effort: 'low' },
  'Gemini 3.1 Pro (High)': { base: 'gemini-3.1-pro', effort: 'high' },
  'Gemini 3.1 Pro (Low)': { base: 'gemini-3.1-pro', effort: 'low' },
  'Claude Sonnet 4.6 (Thinking)': { base: 'claude-sonnet-4-6', effort: null },
  'Claude Opus 4.6 (Thinking)': { base: 'claude-opus-4-6-thinking', effort: null },
  'GPT-OSS 120B (Medium)': { base: 'gpt-oss-120b', effort: 'medium' },
};

/** Resolves any supported model id form (base id, legacy display name, effort-baked id). */
function resolveModel(value) {
  if (findModel(value)) return { base: value, effort: findModel(value).defaultEffort };
  if (LEGACY_MODEL_MAP[value]) return LEGACY_MODEL_MAP[value];
  const match = value.match(/^(.+)-(high|medium|low)$/);
  if (match && findModel(match[1])) return { base: match[1], effort: match[2] };
  return null;
}

// CM-P5: env-provided session defaults, so the backend can pin a model without a config round-trip.
const ENV_MODEL = process.env.AGY_ACP_MODEL?.trim() ? resolveModel(process.env.AGY_ACP_MODEL.trim()) : null;
const ENV_EFFORT = EFFORTS.includes(process.env.AGY_ACP_EFFORT?.trim()) ? process.env.AGY_ACP_EFFORT.trim() : null;
if (process.env.AGY_ACP_MODEL && !ENV_MODEL) logError(`Ignoring unknown AGY_ACP_MODEL='${process.env.AGY_ACP_MODEL}'`);

// --- Modes -----------------------------------------------------------------

const MODE_ACCEPT_EDITS = 'accept-edits';
const MODE_PLAN = 'plan';
const MODE_IDS = [MODE_ACCEPT_EDITS, MODE_PLAN];
const DEFAULT_MODE_ID = MODE_ACCEPT_EDITS;

function modeState(currentModeId) {
  return {
    currentModeId,
    availableModes: [
      { id: MODE_ACCEPT_EDITS, name: 'Accept Edits' },
      { id: MODE_PLAN, name: 'Plan Mode' },
    ],
  };
}

// --- Session state ---------------------------------------------------------
// Persisted to disk and re-read on every prompt, so a respawned adapter can serve an old
// sessionId without a session/load round-trip.

function migrateSession(raw) {
  if (raw.modelBase) {
    return {
      sessionId: raw.sessionId,
      cwd: raw.cwd,
      conversationId: raw.conversationId,
      modelBase: raw.modelBase,
      effort: raw.effort ?? null,
      modeId: raw.modeId ?? DEFAULT_MODE_ID,
      additionalDirectories: raw.additionalDirectories ?? [],
    };
  }
  const resolved = raw.modelId ? resolveModel(raw.modelId) : null;
  return {
    sessionId: raw.sessionId,
    cwd: raw.cwd,
    conversationId: raw.conversationId,
    modelBase: resolved?.base ?? DEFAULT_MODEL_BASE,
    effort: resolved?.effort ?? null,
    modeId: DEFAULT_MODE_ID,
    additionalDirectories: [],
  };
}

async function readState() {
  try {
    const data = await fs.readFile(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    const sessions = {};
    for (const [id, raw] of Object.entries(parsed.sessions ?? {})) sessions[id] = migrateSession(raw);
    return { sessions };
  } catch {
    return { sessions: {} };
  }
}

async function writeState(state) {
  try {
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    logError('Failed to write state file:', err);
  }
}

/** Active child processes keyed by sessionId, for cancellation/close. */
const activeProcesses = {};

// --- Config options --------------------------------------------------------

function effectiveEffort(session) {
  return session.effort ?? findModel(session.modelBase)?.defaultEffort ?? null;
}

function buildConfigOptions(session) {
  const options = [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: session.modelBase,
      options: MODELS.map(m => ({ value: m.base, name: m.name })),
    },
  ];

  const model = findModel(session.modelBase);
  if (model?.supportsEffort) {
    options.push({
      id: 'effort',
      name: 'Reasoning Effort',
      category: 'thought_level',
      type: 'select',
      currentValue: effectiveEffort(session) ?? model.defaultEffort ?? 'high',
      options: EFFORTS.map(e => ({ value: e, name: e[0].toUpperCase() + e.slice(1) })),
    });
  }

  return options;
}

// --- Prompt serialization --------------------------------------------------
// agy `--print` takes a single string, so non-text prompt blocks (embedded context, resource
// links) are serialized into the prompt text. This is what keeps the agentic-profile context
// block of the first turn working.

function serializePrompt(prompt) {
  const parts = [];
  for (const block of prompt) {
    if (block.type === 'text') {
      parts.push(block.text);
    } else if (block.type === 'resource_link') {
      const label = block.name || block.title || block.uri;
      parts.push(block.description ? `${block.description}\n(${label})` : label);
    } else if (block.type === 'resource') {
      const res = block.resource;
      if (res && 'text' in res) {
        const uri = res.uri ? ` (${res.uri})` : '';
        parts.push('```\n' + res.text + '\n```' + uri);
      }
      // Binary resources cannot be inlined into a text prompt; skip them.
    }
    // image/audio blocks are intentionally ignored: agy --print cannot receive them.
  }
  return parts.join('\n\n');
}

// --- Tool call mapping -----------------------------------------------------

function mapToolKind(toolName) {
  const t = toolName || '';
  if (t === 'run_command' || t === 'send_command_input' || t === 'notebook_execution') return 'execute';
  if (t === 'write_to_file' || t === 'replace_file_content' || t === 'multi_replace_file_content' || t === 'sed_file' || t === 'notebook_edit') return 'edit';
  if (t === 'view_file' || t === 'list_dir' || t === 'read_resource' || t === 'list_resources' || t === 'read_url_content' || t === 'list_permissions') return 'read';
  if (t === 'grep_search' || t === 'find_by_name' || t === 'search_web') return 'search';
  if (t === 'invoke_subagent' || t === 'define_subagent' || t === 'manage_subagents' || t === 'manage_task' || t === 'browser_subagent') return 'think';
  return 'other';
}

function extractLocation(parameters) {
  const p = parameters ?? {};
  const filePath = p.TargetFile ?? p.targetFile ?? p.Path ?? p.path ?? p.FilePath ?? p.filePath ?? p.SearchPath;
  return typeof filePath === 'string' ? { path: filePath } : null;
}

// --- CM-P1: turn accounting -------------------------------------------------
// agy reports usage per step AND aggregated in `result`. The aggregate is authoritative; the
// per-step sum is only a fallback for turns that die before emitting `result`.

const numberOrZero = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

function createTurn() {
  return {
    stopReason: 'end_turn',
    resultUsage: null,
    stepUsage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 },
    sawStepUsage: false,
    textChars: 0,
    errors: [],
    status: null,
    conversationId: null,
    numTurns: null,
    durationSeconds: null,
  };
}

function accumulateStepUsage(turn, usage) {
  if (!usage) return;
  turn.sawStepUsage = true;
  for (const key of Object.keys(turn.stepUsage)) turn.stepUsage[key] += numberOrZero(usage[key]);
}

/** Maps agy's usage shape to the ACP `Usage` object returned by `session/prompt`. */
function toAcpUsage(turn) {
  const raw = turn.resultUsage ?? (turn.sawStepUsage ? turn.stepUsage : null);
  if (!raw) return undefined;
  const inputTokens = numberOrZero(raw.input_tokens);
  const outputTokens = numberOrZero(raw.output_tokens);
  const thoughtTokens = numberOrZero(raw.thinking_tokens);
  const cachedReadTokens = numberOrZero(raw.cache_read_tokens);
  const totalTokens = numberOrZero(raw.total_tokens) || inputTokens + outputTokens;
  if (!inputTokens && !outputTokens && !totalTokens) return undefined;
  return {
    totalTokens,
    inputTokens,
    outputTokens,
    ...(thoughtTokens ? { thoughtTokens } : {}),
    ...(cachedReadTokens ? { cachedReadTokens } : {}),
    // agy reports no USD cost through any channel, so no `cost` is attached anywhere.
    _meta: {
      'control-markets/agy': {
        source: turn.resultUsage ? 'result' : 'steps',
        conversationId: turn.conversationId ?? undefined,
        numTurns: turn.numTurns ?? undefined,
        durationSeconds: turn.durationSeconds ?? undefined,
      },
    },
  };
}

// --- agy event handling ----------------------------------------------------

function emit(client, sessionId, update) {
  void client.notify('session/update', { sessionId, update });
}

function emitContextUsage(client, sessionId, usage, modelBase) {
  const used = numberOrZero(usage?.input_tokens) + numberOrZero(usage?.cache_read_tokens);
  if (used <= 0) return;
  // `usage_update` in ACP means context occupancy, not a token count — the token count travels
  // in the prompt response (CM-P1). Both are emitted; the backend reads only the latter.
  emit(client, sessionId, { sessionUpdate: 'usage_update', used, size: contextWindowFor(modelBase) });
}

function handleAgyEvent(eventData, client, session, turn) {
  const { event } = eventData;
  if (!event) return;

  if (event === 'init') {
    // agy 1.1.10 puts conversation_id on the envelope, not inside `init`; older builds omitted it
    // entirely and it was learned from the first step_update. Accept every shape.
    const conversationId = eventData.conversation_id ?? eventData.init?.conversation_id;
    if (conversationId && !session.conversationId) {
      session.conversationId = conversationId;
      logDebug('Learned conversation ID:', conversationId);
    }
    return;
  }

  if (event === 'result') {
    const result = eventData.result ?? {};
    turn.status = result.status ?? null;
    turn.conversationId = result.conversation_id ?? session.conversationId ?? null;
    turn.numTurns = result.num_turns ?? null;
    turn.durationSeconds = result.duration_seconds ?? null;
    if (result.usage) {
      turn.resultUsage = result.usage;
      emitContextUsage(client, session.sessionId, result.usage, session.modelBase);
    }
    if (result.status && result.status !== 'SUCCESS') {
      const message = result.error?.message ?? result.error ?? `agy finished with status ${result.status}`;
      turn.errors.push(typeof message === 'string' ? message : JSON.stringify(message));
    }
    return;
  }

  if (event !== 'step_update') return;

  const step = eventData.step_update;
  if (!step) return;
  const { step_type, state, text_delta, tool_name, tool_info } = step;

  accumulateStepUsage(turn, step.usage);
  if (!session.conversationId && step.conversation_id) session.conversationId = step.conversation_id;

  // CM-P2: agy auto-denies every `ask` permission in headless mode and still exits 0 with
  // status SUCCESS. The only honest failure signals are these steps and stderr.
  if (step_type === 'error_message' || state === 'ERROR') {
    const detail = step.text_delta ?? step.text ?? tool_info?.error?.message ?? `${step_type} step ${step.step_index} in state ${state}`;
    turn.errors.push(String(detail).slice(0, 2000));
  }

  if (step_type === 'agent_response') {
    if (text_delta) {
      turn.textChars += text_delta.length;
      emit(client, session.sessionId, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: text_delta },
        messageId: `msg-${step.step_index}`,
      });
    }
    if (state === 'DONE' && step.usage) emitContextUsage(client, session.sessionId, step.usage, session.modelBase);
    return;
  }

  if (step_type === 'tool') {
    const toolCallId = `tool-${step.step_index}`;
    const info = tool_info ?? {};
    const parameters = info.parameters;

    if (state === 'ACTIVE') {
      const location = extractLocation(parameters);
      emit(client, session.sessionId, {
        sessionUpdate: 'tool_call',
        toolCallId,
        title: tool_name ? tool_name : 'Running tool',
        name: tool_name ?? undefined,
        kind: mapToolKind(tool_name),
        status: 'in_progress',
        rawInput: parameters,
        locations: location ? [location] : undefined,
      });
    } else if (state === 'DONE' || state === 'ERROR') {
      const failed = state === 'ERROR';
      const outputText = failed ? (info?.error?.message ?? 'Tool execution failed') : (info?.output ?? '');
      emit(client, session.sessionId, {
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: failed ? 'failed' : 'completed',
        rawOutput: failed ? info.error : outputText,
        content: outputText ? [{ type: 'content', content: { type: 'text', text: outputText } }] : undefined,
      });
    }
  }
}

// --- agy argument builder --------------------------------------------------

function buildAgyArgs(session, userPrompt) {
  // `-p`/`--print` consumes the next token as its value, so the prompt must sit right after it.
  const args = ['--print', userPrompt, '--output-format', 'stream-json'];

  if (session.conversationId) args.push('--conversation', session.conversationId);

  // Model + effort: split form is required (an effort-baked id conflicts with --effort, and a
  // base id requires --effort when the model supports it).
  args.push('--model', session.modelBase);
  const effort = effectiveEffort(session);
  if (effort) args.push('--effort', effort);

  if (session.modeId !== DEFAULT_MODE_ID) args.push('--mode', session.modeId);

  for (const dir of session.additionalDirectories) args.push('--add-dir', dir);

  // CM-P4: agy's default print timeout is 5m, shorter than the backend's 15m heartbeat budget,
  // so a long autonomous turn would be truncated by the CLI before the backend gives up.
  const printTimeout = process.env.AGY_ACP_PRINT_TIMEOUT?.trim() || '15m';
  args.push('--print-timeout', printTimeout);

  // agy runs headlessly under --print; without auto-approval every command tool fails silently
  // ("a tool required the 'command' permission that headless mode cannot prompt for").
  const sandbox = process.argv.includes('--sandbox') || ['1', 'true', 'yes'].includes((process.env.AGY_ACP_SANDBOX ?? '').toLowerCase());
  const optOut = ['1', 'true', 'yes'].includes((process.env.AGY_ACP_NO_SKIP_PERMISSIONS ?? '').toLowerCase());
  if (!sandbox && !optOut) args.push('--dangerously-skip-permissions');
  if (sandbox) args.push('--sandbox');

  return args;
}

/** CM-P2: the diagnostic shown when a turn produced no text but did produce failures. */
function buildFailureMessage(turn, stderrTail) {
  const lines = ['⚠️ Antigravity terminó el turno sin producir respuesta.'];
  if (turn.status && turn.status !== 'SUCCESS') lines.push(`status: ${turn.status}`);
  if (turn.errors.length) lines.push('', ...turn.errors.slice(0, 5).map(e => `- ${e}`));
  if (stderrTail) lines.push('', '```', stderrTail.slice(-1500).trim(), '```');
  lines.push(
    '',
    'Causa habitual: una herramienta pidió un permiso que el modo headless no puede preguntar y se auto-denegó. ' +
      'Revisa `permissions.allow` en ~/.gemini/antigravity-cli/settings.json o deja activo `--dangerously-skip-permissions`.'
  );
  return lines.join('\n');
}

// --- ACP agent -------------------------------------------------------------

const app = agent({ name: 'agy-acp' })
  .onRequest('initialize', () => ({
    protocolVersion: PROTOCOL_VERSION,
    agentInfo: { name: 'agy-acp', title: 'Google Antigravity (Control Markets)', version: VERSION },
    agentCapabilities: {
      // embeddedContext is honored by serializing resource blocks into the text prompt.
      promptCapabilities: { embeddedContext: true },
      sessionCapabilities: { resume: {}, list: {}, close: {}, delete: {}, additionalDirectories: {} },
    },
  }))
  .onRequest('session/new', async ctx => {
    const { cwd, additionalDirectories } = ctx.params;
    const sessionId = crypto.randomUUID();

    const state = await readState();
    const modelBase = ENV_MODEL?.base ?? DEFAULT_MODEL_BASE;
    const session = {
      sessionId,
      cwd,
      modelBase,
      effort: ENV_EFFORT ?? ENV_MODEL?.effort ?? null,
      modeId: DEFAULT_MODE_ID,
      additionalDirectories: additionalDirectories ?? [],
    };
    state.sessions[sessionId] = session;
    await writeState(state);

    return { sessionId, modes: modeState(session.modeId), configOptions: buildConfigOptions(session) };
  })
  .onRequest('session/list', async () => {
    const state = await readState();
    return {
      sessions: Object.values(state.sessions).map(s => ({
        sessionId: s.sessionId,
        cwd: s.cwd,
        additionalDirectories: s.additionalDirectories,
      })),
    };
  })
  .onRequest('session/delete', async ctx => {
    const state = await readState();
    delete state.sessions[ctx.params.sessionId];
    await writeState(state);
  })
  .onRequest('session/resume', async ctx => {
    const { sessionId, additionalDirectories, cwd } = ctx.params;
    const state = await readState();
    const session = state.sessions[sessionId];
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (cwd) session.cwd = cwd;
    if (additionalDirectories) session.additionalDirectories = additionalDirectories;
    await writeState(state);
    return { sessionId, modes: modeState(session.modeId), configOptions: buildConfigOptions(session) };
  })
  .onRequest('session/set_mode', async ctx => {
    const { sessionId, modeId } = ctx.params;
    const state = await readState();
    const session = state.sessions[sessionId];
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (!MODE_IDS.includes(modeId)) throw new Error(`Unknown mode ${modeId}`);
    session.modeId = modeId;
    await writeState(state);

    emit(ctx.client, sessionId, { sessionUpdate: 'current_mode_update', currentModeId: session.modeId });
  })
  .onRequest('session/set_config_option', async ctx => {
    const { sessionId, configId } = ctx.params;
    const state = await readState();
    const session = state.sessions[sessionId];
    if (!session) throw new Error(`Session ${sessionId} not found`);

    if (configId === 'model') {
      const resolved = resolveModel(String(ctx.params.value));
      if (!resolved) throw new Error(`Unknown model ${ctx.params.value}`);
      session.modelBase = resolved.base;
      // Reset the effort override when switching models so the new model's default applies.
      const model = findModel(resolved.base);
      session.effort = model?.supportsEffort ? model.defaultEffort : null;
    } else if (configId === 'effort') {
      const value = String(ctx.params.value);
      if (!EFFORTS.includes(value)) throw new Error(`Unknown effort ${value}`);
      session.effort = value;
    }
    await writeState(state);

    return { configOptions: buildConfigOptions(session) };
  })
  .onRequest('session/close', async ctx => {
    const child = activeProcesses[ctx.params.sessionId];
    if (child) {
      child.kill('SIGINT');
      delete activeProcesses[ctx.params.sessionId];
    }
  })
  .onRequest('session/prompt', async ctx => {
    const { sessionId, prompt } = ctx.params;
    const state = await readState();
    const session = state.sessions[sessionId];
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const userPrompt = serializePrompt(prompt);
    const agyArgs = buildAgyArgs(session, userPrompt);
    logDebug('spawning', AGY_BIN, agyArgs.map(a => (a === userPrompt ? `<prompt:${userPrompt.length} chars>` : a)).join(' '));

    return new Promise((resolve, reject) => {
      const child = spawn(AGY_BIN, agyArgs, { cwd: session.cwd, env: { ...process.env } });
      activeProcesses[sessionId] = child;

      const turn = createTurn();
      let buffer = '';
      let stderrTail = '';

      child.stdout.on('data', chunk => {
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            handleAgyEvent(JSON.parse(line), ctx.client, session, turn);
          } catch (err) {
            logDebug('raw output:', line);
          }
        }
      });

      child.stderr.on('data', chunk => {
        const text = chunk.toString('utf-8');
        stderrTail = (stderrTail + text).slice(-4000);
        process.stderr.write(chunk);
      });

      child.on('error', err => {
        delete activeProcesses[sessionId];
        reject(
          err.code === 'ENOENT'
            ? new Error(`Failed to start '${AGY_BIN}'. Is the Antigravity CLI installed? Set AGY_ACP_AGY_BIN to its absolute path.`)
            : err
        );
      });

      child.on('close', async code => {
        delete activeProcesses[sessionId];
        await writeState(state);

        const wasKilled = child.killed || code === null;
        // CM-P2: a turn that emitted no assistant text but did emit failures is a failure, no
        // matter what `result.status` claims. Surface it as visible text so the UI shows a reason
        // instead of an empty bubble, and mark the stop reason accordingly.
        const silentFailure = !wasKilled && turn.textChars === 0 && (turn.errors.length > 0 || /no output produced/i.test(stderrTail));
        if (silentFailure) {
          emit(ctx.client, sessionId, {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: buildFailureMessage(turn, stderrTail) },
          });
        }

        resolve({
          stopReason: wasKilled ? 'cancelled' : silentFailure ? 'refusal' : turn.stopReason,
          usage: toAcpUsage(turn), // CM-P1
        });
      });
    });
  })
  .onNotification('session/cancel', async ctx => {
    const child = activeProcesses[ctx.params.sessionId];
    if (child) {
      logDebug('Cancelling active process for session', ctx.params.sessionId);
      child.kill('SIGINT');
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // already gone
        }
      }, 2000);
    }
  });

// --- stdio streaming -------------------------------------------------------

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));

app.connect(stream);
