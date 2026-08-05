import { IAuditable } from '@dataclouder/nest-core';

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

export type AgenticHeartbeatEngine = 'agy' | 'claude' | 'codex';
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
  contextLevel?: AgenticContextLevel;
  delegation?: IAgenticProfileDelegation;

  metadata?: Record<string, any>;
  auditable?: IAuditable;
}
