import { IAuditable } from '@dataclouder/nest-core';
import { PersistedEngine } from '../../common/acp-engines';

/** Engine recorded on a stored conversation. Superset of the dispatchable ACP engines — see
 * `common/acp-engines.ts` for why `builtin` and the retired `acp` label are part of it. */
export type AgenticConversationEngine = PersistedEngine;

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
  /**
   * Cumulative session cost the agent had reported by the end of this turn (ACP `usage_update.cost`
   * is cumulative, not per-turn). `estimatedCostUsd` holds this turn's increment; keeping the raw
   * cumulative makes the accounting self-auditable: the increments of a session must add up to the
   * last value seen here. A mismatch means turn costs are being mis-attributed.
   */
  reportedCumulativeCostUsd?: number;
  /**
   * Version of the CLI/adapter that served the turn. `model` stores the alias the UI selected
   * (`opus[1m]`), and aliases move to newer generations over time — pinning the version is what
   * lets a historical record be resolved back to the model that actually ran.
   */
  engineVersion?: string;
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

/**
 * A source the user pinned to one turn with an `@mention`. Stored per message rather than per
 * conversation because attachments are a per-turn decision — this is what makes it answerable
 * later which documents were in front of the model when it said what it said.
 */
export interface IAgenticConversationAttachment {
  id: string;
  kind?: 'knowledge' | 'skill' | 'exploration' | 'memory' | 'task';
  name?: string;
  characters?: number;
  estimatedTokens?: number;
  truncatedFrom?: number;
  error?: 'not-linked' | 'not-found' | 'over-limit';
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
  attachments?: IAgenticConversationAttachment[];
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
  /** Bridge-side session id (`AcpSession.id`, a backend UUID). Sent back to resume the session. */
  acpSessionId?: string;
  /**
   * CLI-side session id (`session/new` result). Not interchangeable with `acpSessionId`: this is the
   * only value that can correlate a conversation with the agent's own session log on disk.
   */
  cliSessionId?: string;
  messages: IAgenticConversationMessage[];
  usage?: IAgenticTokenUsage;
  injectedContext?: IAgenticConversationInjectedContext;
  auditable?: IAuditable;
}
