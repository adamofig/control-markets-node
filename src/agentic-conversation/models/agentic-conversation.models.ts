import { IAuditable } from '@dataclouder/nest-core';

export type AgenticConversationEngine = 'builtin' | 'acp' | 'claude' | 'codex' | 'agy';

export interface IAgenticTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  estimatedCostUsd?: number;
  provider?: string;
  model?: string;
  source?: 'vercel-ai-sdk' | 'acp';
  pricingVersion?: string;
}

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
  usage?: IAgenticTokenUsage;
}

export interface IAgenticConversationInjectedContext {
  level: 'basic' | 'medium' | 'full';
  content: string;
  characters: number;
  estimatedTokens: number;
  capturedAt: string;
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
  usage?: IAgenticTokenUsage;
  injectedContext?: IAgenticConversationInjectedContext;
  auditable?: IAuditable;
}
