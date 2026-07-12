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

export type AgenticHeartbeatEngine = 'agy' | 'gemini' | 'claude';

export interface IAgenticHeartbeat {
  enabled: boolean;
  cronExpression?: string; // e.g. "0 */6 * * *"
  engine?: AgenticHeartbeatEngine; // ACP engine used to execute the wake-up (default: 'agy')
  wakePrompt?: string; // custom prompt injected on wake-up; falls back to the default exploration prompt
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

  metadata?: Record<string, any>;
  auditable?: IAuditable;
}
