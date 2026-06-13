import { IAuditable } from '@dataclouder/nest-core';

export interface IAgentCardRef {
  id: string;
  name?: string;
  imageUrl?: string;
}

export interface IAgenticProfileSource {
  id: string; // references AgentSourceEntity.id
  name?: string;
  type?: string;
  url?: string;
  description?: string;
}

export interface IAgenticProfileSkill {
  id: string; // references AgentSourceEntity.id
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
  id: string; // references AgentSourceEntity.id (representing a memory source)
  name?: string;
  description?: string;
  enabled: boolean;
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

  metadata?: Record<string, any>;
  auditable?: IAuditable;
}
