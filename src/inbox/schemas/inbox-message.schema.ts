import { AuditDataSchema, IAuditable } from '@dataclouder/nest-core';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import {
  IInboxAgentExecutionSnapshot,
  IInboxMessage,
  IInboxMessageOrigin,
  InboxMessagePart,
  INBOX_AGENT_EXECUTION_STATUSES,
  INBOX_AGENT_MODES,
  INBOX_AUDIO_SOURCES,
  INBOX_MESSAGE_KINDS,
  INBOX_MESSAGE_PART_TYPES,
  INBOX_MESSAGE_ROLES,
  INBOX_MESSAGE_STATUSES,
  INBOX_ORIGIN_CHANNELS,
  INBOX_TEXT_FORMATS,
  InboxAgentExecutionStatus,
  InboxAgentMode,
  InboxAudioSource,
  InboxMessageKind,
  InboxMessagePartType,
  InboxMessageRole,
  InboxMessageStatus,
  InboxOriginChannel,
  InboxTextFormat,
} from '../models/inbox.models';

@Schema({ _id: false })
export class InboxWordTimestampEntity {
  @Prop({ type: String, required: true }) text: string;
  @Prop({ type: Number, required: true, min: 0 }) startMs: number;
  @Prop({ type: Number, required: true, min: 0 }) endMs: number;
}

const InboxWordTimestampSchema = SchemaFactory.createForClass(InboxWordTimestampEntity);

@Schema({ _id: false })
export class InboxVoiceEntity {
  @Prop({ type: String, required: true }) provider: string;
  @Prop({ type: String, required: true }) voiceId: string;
  @Prop({ type: String }) model?: string;
  @Prop({ type: String }) language?: string;
  @Prop({ type: Number, min: 0 }) speed?: number;
  @Prop({ type: String }) effect?: string;
}

const InboxVoiceSchema = SchemaFactory.createForClass(InboxVoiceEntity);

@Schema({ _id: false })
export class InboxMessagePartEntity {
  @Prop({ type: String, required: true, enum: INBOX_MESSAGE_PART_TYPES }) type: InboxMessagePartType;
  @Prop({ type: String }) text?: string;
  @Prop({ type: String, enum: INBOX_TEXT_FORMATS }) format?: InboxTextFormat;
  @Prop({ type: String }) language?: string;
  @Prop({ type: String }) storageAssetId?: string;
  @Prop({ type: String, enum: INBOX_AUDIO_SOURCES }) source?: InboxAudioSource;
  @Prop({ type: String }) mimeType?: string;
  @Prop({ type: Number, min: 0 }) durationMs?: number;
  @Prop({ type: String }) transcript?: string;
  @Prop({ type: [InboxWordTimestampSchema] }) words?: { text: string; startMs: number; endMs: number }[];
  @Prop({ type: InboxVoiceSchema }) voice?: {
    provider: string;
    voiceId: string;
    model?: string;
    language?: string;
    speed?: number;
    effect?: string;
  };
  @Prop({ type: String }) name?: string;
  @Prop({ type: String }) caption?: string;
  @Prop({ type: Number, min: 0 }) sizeBytes?: number;
}

const InboxMessagePartSchema = SchemaFactory.createForClass(InboxMessagePartEntity);

@Schema({ _id: false })
export class InboxAgentExecutionSnapshotEntity implements IInboxAgentExecutionSnapshot {
  @Prop({ type: String, required: true, enum: INBOX_AGENT_MODES }) mode: InboxAgentMode;
  @Prop({ type: String, required: true, enum: INBOX_AGENT_EXECUTION_STATUSES }) status: InboxAgentExecutionStatus;
  @Prop({ type: String }) engine?: string;
  @Prop({ type: String }) externalSessionId?: string;
  @Prop({ type: String }) reasoning?: string;
  @Prop({ type: [mongoose.Schema.Types.Mixed], default: [] }) plan?: { content: string; status?: string }[];
  @Prop({ type: [mongoose.Schema.Types.Mixed], default: [] }) tools?: IInboxAgentExecutionSnapshot['tools'];
  @Prop({ type: [mongoose.Schema.Types.Mixed], default: [] }) permissions?: IInboxAgentExecutionSnapshot['permissions'];
  @Prop({ type: mongoose.Schema.Types.Mixed }) usage?: IInboxAgentExecutionSnapshot['usage'];
  @Prop({ type: mongoose.Schema.Types.Mixed }) injectedContext?: IInboxAgentExecutionSnapshot['injectedContext'];
  @Prop({ type: String }) error?: string;
}

const InboxAgentExecutionSnapshotSchema = SchemaFactory.createForClass(InboxAgentExecutionSnapshotEntity);

@Schema({ _id: false })
export class InboxMessageOriginEntity implements IInboxMessageOrigin {
  @Prop({ type: String, required: true, enum: INBOX_ORIGIN_CHANNELS }) channel: InboxOriginChannel;
  @Prop({ type: String }) providerMessageId?: string;
}

const InboxMessageOriginSchema = SchemaFactory.createForClass(InboxMessageOriginEntity);

export type InboxMessageDocument = HydratedDocument<InboxMessageEntity>;

@Schema({ collection: 'inbox_messages', timestamps: true })
export class InboxMessageEntity implements IInboxMessage {
  @Prop({ type: String }) id?: string;
  @Prop({ type: String, required: true }) orgId: string;
  @Prop({ type: String, required: true }) conversationId: string;
  @Prop({ type: Number, required: true, min: 1 }) sequence: number;
  @Prop({ type: String, trim: true, maxlength: 128 }) clientMessageId?: string;
  @Prop({ type: String, required: true }) senderParticipantId: string;
  @Prop({ type: String, required: true, enum: INBOX_MESSAGE_ROLES }) role: InboxMessageRole;
  @Prop({ type: String, required: true, enum: INBOX_MESSAGE_KINDS, default: 'message' }) kind: InboxMessageKind;
  @Prop({ type: String, required: true, enum: INBOX_MESSAGE_STATUSES, default: 'sent' }) status: InboxMessageStatus;
  @Prop({ type: [InboxMessagePartSchema], required: true, default: [] }) parts: InboxMessagePart[];
  @Prop({ type: String }) replyToMessageId?: string;
  @Prop({ type: String }) groupId?: string;
  @Prop({ type: InboxAgentExecutionSnapshotSchema }) agentExecution?: IInboxAgentExecutionSnapshot;
  @Prop({ type: InboxMessageOriginSchema, default: { channel: 'internal' } }) origin?: IInboxMessageOrigin;
  @Prop({ type: Date }) editedAt?: Date;
  @Prop({ type: Date }) deletedAt?: Date;
  @Prop({ type: AuditDataSchema, default: {} }) auditable?: IAuditable;
}

export const InboxMessageSchema = SchemaFactory.createForClass(InboxMessageEntity);

addIdAfterSave(InboxMessageSchema);

InboxMessageSchema.index({ id: 1 }, { unique: true });
InboxMessageSchema.index({ orgId: 1, conversationId: 1, sequence: -1 }, { unique: true });
InboxMessageSchema.index({ orgId: 1, conversationId: 1, createdAt: -1, _id: -1 });
InboxMessageSchema.index({ orgId: 1, conversationId: 1, clientMessageId: 1 }, { unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } } });
