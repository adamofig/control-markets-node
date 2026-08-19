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

/**
 * Where a skill ref came from, and therefore who owns it.
 *
 * - `markdown`: declared in the profile `.md` (frontmatter `skills[]`, or legacy Section 4). The file
 *   is its source of truth, so every sync rewrites the ref from the file.
 * - `platform`: attached from the UI skill catalog. No file declares it, so the sync must leave it
 *   alone — otherwise checking a skill in the UI would be silently undone by the next sync.
 *
 * Absent on refs written before the catalog existed; those are treated as `markdown`.
 */
export type AgenticSkillOrigin = 'markdown' | 'platform';

export interface IAgenticProfileSkill {
  id: string; // references SourceEntity.id
  name?: string;
  description?: string;
  enabled: boolean;
  /** `SourceEntity.sourceUrl` — the profile-relative `.md` path when the skill came from the wiki. */
  url?: string;
  origin?: AgenticSkillOrigin;
}

/** One row of the org-wide skill catalog offered by the UI to attach skills to a profile. */
export interface ISkillCatalogItem {
  id: string;
  name?: string;
  description?: string;
  url?: string;
  updatedAt?: string | Date;
  /** Atomic operations of this skill — lets the UI show what a bundle can actually do */
  capabilities?: Array<{ id: string; slug: string; name?: string; description?: string; triggers?: string[] }>;
}

/** Body of `PUT /api/agentic-profile/:id/skills`. Only ids and flags are trusted from the client. */
export interface ISkillLinkInput {
  id: string;
  enabled?: boolean;
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

/** Who is reading the compiled context. `builtin` is the in-process Vercel harness. */
export type AgenticRuntimeEngine = AcpEngine | 'builtin';

/**
 * What the reader of a compiled context can actually do in THIS run.
 *
 * The context index used to be written for a single imaginary reader that had `getSkill` and a
 * checkout of the wiki. ACP engines have neither, so they were handed two impossible instructions
 * on every turn. Whoever composes a context now declares the reader, and the index adapts.
 */
export interface AgenticRuntimeProfile {
  engine: AgenticRuntimeEngine;
  /** REAL names of the tools registered for this run — derived from the tool set, never a constant. */
  tools: string[];
  /**
   * Directories the reader can open, most relevant first (an ACP engine's `cwd` leads).
   * Being listed is not proof the wiki is there: every path is checked against disk before it is
   * printed, which is what keeps `LOCAL_AGENT_WORKSPACE_ROOTS=/app` from becoming a false positive.
   */
  workspaceRoots?: string[];
}

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
