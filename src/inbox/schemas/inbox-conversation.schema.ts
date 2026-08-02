import { AuditDataSchema, IAuditable } from '@dataclouder/nest-core';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  IInboxAgentContext,
  IInboxContextReference,
  IInboxConversation,
  IInboxLastMessage,
  IInboxParticipantSnapshot,
  INBOX_AGENT_ENGINES,
  INBOX_AGENT_MODES,
  INBOX_CONTENT_TYPES,
  INBOX_CONTEXT_RELATIONS,
  INBOX_CONTEXT_TYPES,
  INBOX_CONVERSATION_STATUSES,
  INBOX_CONVERSATION_TYPES,
  INBOX_PARTICIPANT_TYPES,
  InboxAgentEngine,
  InboxAgentMode,
  InboxContentType,
  InboxContextRelation,
  InboxContextType,
  InboxConversationStatus,
  InboxConversationType,
  InboxParticipantType,
} from '../models/inbox.models';

@Schema({ _id: false })
export class InboxParticipantSnapshotEntity implements IInboxParticipantSnapshot {
  @Prop({ type: String, required: true }) participantId: string;
  @Prop({ type: String, required: true, enum: INBOX_PARTICIPANT_TYPES }) type: InboxParticipantType;
  @Prop({ type: String, required: true }) refId: string;
  @Prop({ type: String, required: true }) displayName: string;
  @Prop({ type: String }) avatarAssetId?: string;
  @Prop({ type: String }) avatarUrl?: string;
}

const InboxParticipantSnapshotSchema = SchemaFactory.createForClass(InboxParticipantSnapshotEntity);

@Schema({ _id: false })
export class InboxContextReferenceEntity implements IInboxContextReference {
  @Prop({ type: String, required: true, enum: INBOX_CONTEXT_TYPES }) type: InboxContextType;
  @Prop({ type: String, required: true }) entityId: string;
  @Prop({ type: String, required: true, enum: INBOX_CONTEXT_RELATIONS }) relation: InboxContextRelation;
}

const InboxContextReferenceSchema = SchemaFactory.createForClass(InboxContextReferenceEntity);

@Schema({ _id: false })
export class InboxAgentContextEntity implements IInboxAgentContext {
  @Prop({ type: String, required: true, enum: INBOX_AGENT_MODES }) agentMode: InboxAgentMode;
  @Prop({ type: String }) agentCardId?: string;
  @Prop({ type: String }) agenticProfileId?: string;
  @Prop({ type: String }) configVersion?: string;
  @Prop({ type: String }) conversationType?: string;
  @Prop({ type: String, enum: INBOX_AGENT_ENGINES }) engine?: InboxAgentEngine;
  @Prop({ type: String }) externalSessionId?: string;
}

const InboxAgentContextSchema = SchemaFactory.createForClass(InboxAgentContextEntity);

@Schema({ _id: false })
export class InboxLastMessageEntity implements IInboxLastMessage {
  @Prop({ type: String, required: true }) messageId: string;
  @Prop({ type: Number, required: true, min: 1 }) sequence: number;
  @Prop({ type: String, required: true }) senderParticipantId: string;
  @Prop({ type: String, required: true }) preview: string;
  @Prop({ type: String, required: true, enum: INBOX_CONTENT_TYPES }) contentType: InboxContentType;
  @Prop({ type: Date, required: true }) createdAt: Date;
}

const InboxLastMessageSchema = SchemaFactory.createForClass(InboxLastMessageEntity);

export type InboxConversationDocument = HydratedDocument<InboxConversationEntity>;

@Schema({ collection: 'inbox_conversations', timestamps: true })
export class InboxConversationEntity implements IInboxConversation {
  @Prop({ type: String }) id?: string;
  @Prop({ type: String, required: true }) orgId: string;
  @Prop({ type: String, required: true, enum: INBOX_CONVERSATION_TYPES }) type: InboxConversationType;
  @Prop({ type: String, trim: true }) title?: string;
  @Prop({ type: String, required: true, enum: INBOX_CONVERSATION_STATUSES, default: 'open' }) status: InboxConversationStatus;
  @Prop({ type: [InboxParticipantSnapshotSchema], required: true, default: [] }) participants: IInboxParticipantSnapshot[];
  @Prop({ type: [String], required: true, default: [] }) participantRefIds: string[];
  @Prop({ type: [InboxContextReferenceSchema], default: [] }) contexts?: IInboxContextReference[];
  @Prop({ type: InboxAgentContextSchema }) agentContext?: IInboxAgentContext;
  @Prop({ type: String, trim: true }) dedupeKey?: string;
  @Prop({ type: InboxLastMessageSchema }) lastMessage?: IInboxLastMessage;
  @Prop({ type: Number, required: true, default: 0, min: 0 }) lastMessageSequence: number;
  @Prop({ type: Number, required: true, default: 0, min: 0 }) messageCount: number;
  @Prop({ type: AuditDataSchema, default: {} }) auditable?: IAuditable;
}

export const InboxConversationSchema = SchemaFactory.createForClass(InboxConversationEntity);

addIdAfterSave(InboxConversationSchema);

InboxConversationSchema.index({ id: 1 }, { unique: true });
InboxConversationSchema.index({ orgId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
InboxConversationSchema.index({ orgId: 1, updatedAt: -1 });
InboxConversationSchema.index({ orgId: 1, participantRefIds: 1, updatedAt: -1 });
