import { IAuditable } from '@dataclouder/nest-core';

export type AgenticConversationEngine = 'builtin' | 'acp' | 'claude' | 'codex' | 'agy';

export interface IAgenticConversationTool {
  toolName: string;
  input?: unknown;
  output?: unknown;
  status: 'executing' | 'completed' | 'error';
}

export interface IAgenticConversationPermission {
  requestId: string;
  toolName: string;
  rationale?: string;
  options?: { optionId: string; name: string; kind: string }[];
  answered?: string;
  status: 'pending' | 'allowed' | 'denied';
}

export interface IAgenticConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  tools?: IAgenticConversationTool[];
  permissions?: IAgenticConversationPermission[];
  plan?: { content?: string; status?: string }[];
  createdAt?: string;
}

export interface IAgenticConversation {
  _id?: string;
  id?: string;
  orgId: string;
  profileId: string;
  agentCardId?: string;
  name?: string;
  status: 'active' | 'archived';
  engine?: AgenticConversationEngine;
  acpSessionId?: string;
  messages: IAgenticConversationMessage[];
  auditable?: IAuditable;
}
