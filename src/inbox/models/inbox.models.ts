import { IAuditable } from '@dataclouder/nest-core';
import { IAgenticConversationInjectedContext, IAgenticConversationPermission, IAgenticConversationTool, IAgenticTokenUsage } from '../../agentic-conversation/models/agentic-conversation.models';
import { PERSISTED_ENGINES, PersistedEngine } from '../../common/acp-engines';

export const INBOX_CONVERSATION_TYPES = ['direct', 'group', 'task', 'agent'] as const;
export type InboxConversationType = (typeof INBOX_CONVERSATION_TYPES)[number];

export const INBOX_CONVERSATION_STATUSES = ['open', 'closed'] as const;
export type InboxConversationStatus = (typeof INBOX_CONVERSATION_STATUSES)[number];

/**
 * `conversational` is the reactive Inbox mode: the user writes, the agent answers in the thread as
 * a normal chat message. `agentic` keeps the forensic full-stream experience (reasoning, tools and
 * HITL permissions rendered live) and `roleplay` the persona-only chat. The three share the same
 * storage — only the presentation and the dispatch strategy differ.
 */
export const INBOX_AGENT_MODES = ['roleplay', 'agentic', 'conversational'] as const;
export type InboxAgentMode = (typeof INBOX_AGENT_MODES)[number];

export const INBOX_PARTICIPANT_TYPES = ['user', 'agent_card', 'agentic_profile', 'system'] as const;
export type InboxParticipantType = (typeof INBOX_PARTICIPANT_TYPES)[number];

export const INBOX_CONTEXT_TYPES = ['task', 'flow', 'job', 'lead', 'blog_entry'] as const;
export type InboxContextType = (typeof INBOX_CONTEXT_TYPES)[number];

export const INBOX_CONTEXT_RELATIONS = ['primary', 'related'] as const;
export type InboxContextRelation = (typeof INBOX_CONTEXT_RELATIONS)[number];

/** Same engine labels a stored conversation may carry — see `common/acp-engines.ts`. */
export const INBOX_AGENT_ENGINES = PERSISTED_ENGINES;
export type InboxAgentEngine = PersistedEngine;

export const INBOX_CONTENT_TYPES = ['text', 'audio', 'image', 'video', 'file', 'event'] as const;
export type InboxContentType = (typeof INBOX_CONTENT_TYPES)[number];

export const INBOX_MEMBERSHIP_ROLES = ['owner', 'member', 'agent'] as const;
export type InboxMembershipRole = (typeof INBOX_MEMBERSHIP_ROLES)[number];

export const INBOX_MESSAGE_STATUSES = ['pending', 'streaming', 'sent', 'failed', 'deleted'] as const;
export type InboxMessageStatus = (typeof INBOX_MESSAGE_STATUSES)[number];

export const INBOX_MESSAGE_ROLES = ['user', 'assistant', 'system', 'tool'] as const;
export type InboxMessageRole = (typeof INBOX_MESSAGE_ROLES)[number];

export const INBOX_MESSAGE_KINDS = ['message', 'event', 'system'] as const;
export type InboxMessageKind = (typeof INBOX_MESSAGE_KINDS)[number];

export const INBOX_MESSAGE_PART_TYPES = ['text', 'audio', 'image', 'video', 'file'] as const;
export type InboxMessagePartType = (typeof INBOX_MESSAGE_PART_TYPES)[number];

export const INBOX_TEXT_FORMATS = ['plain', 'markdown', 'ssml'] as const;
export type InboxTextFormat = (typeof INBOX_TEXT_FORMATS)[number];

export const INBOX_AUDIO_SOURCES = ['recording', 'tts'] as const;
export type InboxAudioSource = (typeof INBOX_AUDIO_SOURCES)[number];

export const INBOX_AGENT_EXECUTION_STATUSES = ['running', 'waiting_permission', 'completed', 'failed', 'cancelled'] as const;
export type InboxAgentExecutionStatus = (typeof INBOX_AGENT_EXECUTION_STATUSES)[number];

export const INBOX_ORIGIN_CHANNELS = ['internal', 'telegram', 'whatsapp', 'slack', 'system'] as const;
export type InboxOriginChannel = (typeof INBOX_ORIGIN_CHANNELS)[number];

export const INBOX_PROVENANCE_AUTH_TYPES = ['pat_delegation', 'internal_runtime', 'agent_runtime_token'] as const;
export type InboxProvenanceAuthType = (typeof INBOX_PROVENANCE_AUTH_TYPES)[number];

export const INBOX_PROVENANCE_SOURCES = ['rest', 'mcp', 'heartbeat', 'task_automation', 'local'] as const;
export type InboxProvenanceSource = (typeof INBOX_PROVENANCE_SOURCES)[number];

export interface IInboxParticipantSnapshot {
  participantId: string;
  type: InboxParticipantType;
  refId: string;
  displayName: string;
  avatarAssetId?: string;
  avatarUrl?: string;
}

export interface IInboxContextReference {
  type: InboxContextType;
  entityId: string;
  relation: InboxContextRelation;
}

export interface IInboxAgentContext {
  agentMode: InboxAgentMode;
  agentCardId?: string;
  agenticProfileId?: string;
  configVersion?: string;
  conversationType?: string;
  engine?: InboxAgentEngine;
  externalSessionId?: string;
}

export interface IInboxLastMessage {
  messageId: string;
  sequence: number;
  senderParticipantId: string;
  preview: string;
  contentType: InboxContentType;
  createdAt: Date;
}

export interface IInboxConversation {
  _id?: string;
  id?: string;
  orgId: string;
  type: InboxConversationType;
  title?: string;
  status: InboxConversationStatus;
  participants: IInboxParticipantSnapshot[];
  participantRefIds: string[];
  contexts?: IInboxContextReference[];
  agentContext?: IInboxAgentContext;
  dedupeKey?: string;
  lastMessage?: IInboxLastMessage;
  lastMessageSequence: number;
  messageCount: number;
  createdAt?: Date;
  updatedAt?: Date;
  auditable?: IAuditable;
}

export interface IInboxMembership {
  _id?: string;
  id?: string;
  orgId: string;
  conversationId: string;
  participantId: string;
  memberType: InboxParticipantType;
  memberRefId: string;
  role: InboxMembershipRole;
  joinedAt: Date;
  leftAt?: Date;
  lastReadMessageId?: string;
  lastReadSequence: number;
  lastReadAt?: Date;
  unreadCount: number;
  pinnedAt?: Date;
  mutedUntil?: Date;
  archivedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IInboxTextPart {
  type: 'text';
  text: string;
  format: InboxTextFormat;
  language?: string;
}

export interface IInboxAudioPart {
  type: 'audio';
  storageAssetId: string;
  source: InboxAudioSource;
  mimeType?: string;
  durationMs?: number;
  transcript?: string;
  words?: { text: string; startMs: number; endMs: number }[];
  voice?: {
    provider: string;
    voiceId: string;
    model?: string;
    language?: string;
    speed?: number;
    effect?: string;
  };
}

export interface IInboxAssetPart {
  type: 'image' | 'video' | 'file';
  storageAssetId: string;
  mimeType?: string;
  name?: string;
  caption?: string;
  sizeBytes?: number;
}

export type InboxMessagePart = IInboxTextPart | IInboxAudioPart | IInboxAssetPart;

export interface IInboxAgentExecutionSnapshot {
  mode: InboxAgentMode;
  status: InboxAgentExecutionStatus;
  engine?: string;
  externalSessionId?: string;
  reasoning?: string;
  plan?: { content: string; status?: string }[];
  tools?: IAgenticConversationTool[];
  permissions?: IAgenticConversationPermission[];
  usage?: IAgenticTokenUsage;
  injectedContext?: IAgenticConversationInjectedContext;
  error?: string;
}

export interface IInboxMessageOrigin {
  channel: InboxOriginChannel;
  providerMessageId?: string;
}

export interface IInboxMessageProvenance {
  authType: InboxProvenanceAuthType;
  authenticatedUserId?: string;
  agenticProfileId: string;
  agentCardId: string;
  source: InboxProvenanceSource;
  executionId?: string;
  engine?: string;
}

export interface IInboxMessage {
  _id?: string;
  id?: string;
  orgId: string;
  conversationId: string;
  sequence: number;
  clientMessageId?: string;
  senderParticipantId: string;
  role: InboxMessageRole;
  kind: InboxMessageKind;
  status: InboxMessageStatus;
  parts: InboxMessagePart[];
  replyToMessageId?: string;
  groupId?: string;
  agentExecution?: IInboxAgentExecutionSnapshot;
  origin?: IInboxMessageOrigin;
  provenance?: IInboxMessageProvenance;
  createdAt?: Date;
  updatedAt?: Date;
  editedAt?: Date;
  deletedAt?: Date;
  auditable?: IAuditable;
}
