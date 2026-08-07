/**
 * Canonical agentic engine ids — the single source of truth for every module that dispatches,
 * stores or validates an engine. It lives in `common/` rather than `local-agent/` so the profile,
 * conversation and inbox domains can import it without pulling in the bridge implementation.
 *
 * Before this file the union was duplicated in four places (the bridge, the profile heartbeat, the
 * agentic conversation and the inbox) and had to be kept in sync by hand.
 *
 * `gemini` (`gemini --acp`) was removed on 2026-08-04: Google retired that client for individual
 * accounts, so every session failed at the handshake. Antigravity (`agy`) is the Google path now.
 * See wiki `02-references/09-agentic-profile-(borges)/local-agent-acp-connectors-performance.md`.
 */
export const ACP_ENGINES = ['claude', 'codex', 'agy'] as const;

/** ACP agents the bridge can spawn. The protocol is agent-agnostic — only the command differs. */
export type AcpEngine = (typeof ACP_ENGINES)[number];

/** Engine used when the caller sends none, and no profile default applies. */
export const DEFAULT_ACP_ENGINE: AcpEngine = 'agy';

export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type CodexReasoningEffort = (typeof REASONING_EFFORTS)[number];

/**
 * Engine labels persisted on conversations and messages. A superset of {@link ACP_ENGINES}: it also
 * covers `builtin` (the in-process Vercel AI harness, which is not an ACP engine and therefore
 * cannot be selected as a profile default) and the retired generic `acp` label, kept so historical
 * documents keep validating.
 */
export const PERSISTED_ENGINES = ['builtin', 'acp', ...ACP_ENGINES] as const;
export type PersistedEngine = (typeof PERSISTED_ENGINES)[number];

/** Narrows an untrusted value to a dispatchable ACP engine, or `undefined` if it is not one. */
export function asAcpEngine(value: unknown): AcpEngine | undefined {
  return typeof value === 'string' && (ACP_ENGINES as readonly string[]).includes(value) ? (value as AcpEngine) : undefined;
}

/** Narrows an untrusted value to a reasoning effort, or `undefined` if it is not one. */
export function asReasoningEffort(value: unknown): CodexReasoningEffort | undefined {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value)
    ? (value as CodexReasoningEffort)
    : undefined;
}
