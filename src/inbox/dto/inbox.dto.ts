import { InboxMessagePart, InboxProvenanceSource } from '../models/inbox.models';

export interface CreateDirectConversationDto {
  userId: string;
}

export interface CreateGroupConversationDto {
  userIds: string[];
  title: string;
}

export interface SendInboxMessageDto {
  clientMessageId: string;
  parts: InboxMessagePart[];
  replyToMessageId?: string;
  groupId?: string;
}

export interface SendAgentInboxMessageDto {
  targetUserId: string;
  clientMessageId: string;
  parts: InboxMessagePart[];
  replyToMessageId?: string;
  groupId?: string;
  source?: {
    type?: InboxProvenanceSource;
    executionId?: string;
    engine?: string;
  };
}

export interface MarkInboxReadDto {
  throughSequence: number;
}

export interface UpdateInboxMembershipDto {
  archived?: boolean;
  pinned?: boolean;
  mutedUntil?: string | null;
}
