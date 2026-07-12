import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { AuditDataSchema, IAuditable } from '@dataclouder/nest-core';
import { IAgenticConversation, IAgenticConversationMessage, AgenticConversationEngine, IAgenticTokenUsage } from '../models/agentic-conversation.models';

export type AgenticConversationDocument = AgenticConversationEntity & Document;

@Schema({ collection: 'agentic_conversations', timestamps: true })
export class AgenticConversationEntity implements IAgenticConversation {
  @Prop() id: string;
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ required: true, index: true }) profileId: string;
  @Prop({ index: true }) agentCardId?: string;
  @Prop() name?: string;
  @Prop({ type: String, required: true, enum: ['active', 'archived'], default: 'active', index: true }) status: 'active' | 'archived';
  @Prop({ type: String, enum: ['builtin', 'acp', 'claude', 'codex', 'agy'] }) engine?: AgenticConversationEngine;
  @Prop() acpSessionId?: string;
  @Prop({ type: [Object], required: true, default: [] }) messages: IAgenticConversationMessage[];
  @Prop({ type: Object, required: false }) usage?: IAgenticTokenUsage;
  @Prop({ type: AuditDataSchema, required: false, default: {} }) auditable?: IAuditable;
}

export const AgenticConversationSchema = SchemaFactory.createForClass(AgenticConversationEntity);
addIdAfterSave(AgenticConversationSchema);
AgenticConversationSchema.index({ id: 1 }, { unique: true });
AgenticConversationSchema.index({ orgId: 1, profileId: 1, status: 1, updatedAt: -1 });
