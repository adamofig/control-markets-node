import { IAuditable } from '@dataclouder/nest-core';
import { AcpEngine, CodexReasoningEffort } from '../../common/acp-engines';

export interface IAgentCardRef {
  id: string;
  name?: string;
  imageUrl?: string;
}

export interface IAgenticProfileSource {
  id: string; // references SourceEntity.id
  name?: string;
  type?: string;
  url?: string;
  description?: string;
}

export interface IAgenticProfileSkill {
  id: string; // references SourceEntity.id
  name?: string;
  description?: string;
  enabled: boolean;
}

export interface IAgenticProfileTaskRef {
  id: string; // references AgentTaskEntity.id
  name?: string;
  status?: string;
  priority?: number; // 1..5, mirrors AgentTaskEntity.priority
  updatedAt?: string; // mirrors AgentTaskEntity.updatedAt at the time the ref was last (re)written
}

export interface IAgenticProfileMemory {
  id: string; // references SourceEntity.id (representing a memory source)
  name?: string;
  description?: string;
  enabled: boolean;
}

export interface IAgenticProfileExploration {
  id: string; // references SourceEntity.id (representing an exploration source)
  name?: string;
  description?: string;
  enabled: boolean;
}

/** Alias kept for the heartbeat's historical field name; the union itself is canonical now. */
export type AgenticHeartbeatEngine = AcpEngine;
export type AgenticContextLevel = 'basic' | 'medium' | 'full';

/**
 * Category of a resource linked to a profile. Always derived from WHICH of the profile's own
 * arrays holds the id — never from the caller, so nobody can relabel a task as a source to
 * reach a different collection.
 */
export type AgenticLinkedResourceKind = 'knowledge' | 'skill' | 'exploration' | 'memory' | 'task';

/** A resource the user attached to a single chat turn through the `@` mention menu. */
export interface IAttachedSourceRef {
  id: string;
  /** UI hint only; the server re-derives the authoritative kind from the profile. */
  kind?: AgenticLinkedResourceKind;
}

export interface ILinkedContextResource {
  id: string;
  /** Absent only when the ref could not be resolved — see `error`. */
  kind?: AgenticLinkedResourceKind;
  name?: string;
  description?: string;
  sourceUrl?: string;
  content?: string;
  /** Only for `task` refs. */
  status?: string;
  error?: 'not-linked' | 'not-found';
}

export interface IAgenticHeartbeat {
  enabled: boolean;
  cronExpression?: string; // e.g. "0 */6 * * *"
  timezone?: string; // IANA timezone used by the heartbeat CronJob
  engine?: AgenticHeartbeatEngine; // ACP engine used to execute the wake-up (default: 'agy')
  wakePrompt?: string; // custom prompt injected on wake-up; falls back to the default exploration prompt
}

/**
 * The profile's default agentic engine — the canonical place the model lives.
 *
 * It seeds, it does not impose: a chat request that names its own engine/model still wins, so the
 * header selector keeps working as a per-session override without touching the profile. The
 * resolution order is `request → heartbeat.engine (cron only) → acpConfig → DEFAULT_ACP_ENGINE`.
 *
 * Two deliberate limits:
 * - `builtin` is not selectable. It is the in-process Vercel AI harness, not an ACP engine, and its
 *   request contract carries no model — it stays on `LOCAL_AGENT_MODEL`.
 * - `defaultModel` and `reasoningEffort` belong to `defaultEngine`. Model ids are not portable
 *   across engines, so switching engine in the chat falls back to that engine's adapter default
 *   rather than carrying an invalid id over.
 */
export interface IAgenticProfileAcpConfig {
  defaultEngine?: AcpEngine;
  /** Engine-specific model id, e.g. `gemini-3.6-flash` for `agy`, `sonnet` for `claude`. */
  defaultModel?: string;
  /** Only `agy` and `codex` honour this; Claude Code has no effort option. */
  reasoningEffort?: CodexReasoningEffort;
}

export interface IAgenticProfilePatDelegation {
  enabled: boolean;
  allowedUserIds: string[];
}

export interface IAgenticProfileDelegation {
  pat: IAgenticProfilePatDelegation;
}

export interface IAgenticProfile {
  _id?: string;
  id?: string;
  orgId?: string;

  name?: string;
  title?: string;
  description?: string;
  domain?: string;

  agentCard?: IAgentCardRef;
  sources?: IAgenticProfileSource[];
  skills?: IAgenticProfileSkill[];
  tasks?: IAgenticProfileTaskRef[];
  memories?: IAgenticProfileMemory[];
  explorations?: IAgenticProfileExploration[];
  liveBriefing?: string;
  heartbeat?: IAgenticHeartbeat;
  acpConfig?: IAgenticProfileAcpConfig;
  contextLevel?: AgenticContextLevel;
  delegation?: IAgenticProfileDelegation;

  metadata?: Record<string, any>;
  auditable?: IAuditable;
}
