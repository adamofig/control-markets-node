import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { IInboxMembership, INBOX_MEMBERSHIP_ROLES, INBOX_PARTICIPANT_TYPES, InboxMembershipRole, InboxParticipantType } from '../models/inbox.models';

export type InboxMembershipDocument = HydratedDocument<InboxMembershipEntity>;

@Schema({ collection: 'inbox_memberships', timestamps: true })
export class InboxMembershipEntity implements IInboxMembership {
  @Prop({ type: String }) id?: string;
  @Prop({ type: String, required: true }) orgId: string;
  @Prop({ type: String, required: true }) conversationId: string;
  @Prop({ type: String, required: true }) participantId: string;
  @Prop({ type: String, required: true, enum: INBOX_PARTICIPANT_TYPES }) memberType: InboxParticipantType;
  @Prop({ type: String, required: true }) memberRefId: string;
  @Prop({ type: String, required: true, enum: INBOX_MEMBERSHIP_ROLES }) role: InboxMembershipRole;
  @Prop({ type: Date, required: true, default: () => new Date() }) joinedAt: Date;
  @Prop({ type: Date }) leftAt?: Date;
  @Prop({ type: String }) lastReadMessageId?: string;
  @Prop({ type: Number, required: true, default: 0, min: 0 }) lastReadSequence: number;
  @Prop({ type: Date }) lastReadAt?: Date;
  @Prop({ type: Number, required: true, default: 0, min: 0 }) unreadCount: number;
  @Prop({ type: Date }) pinnedAt?: Date;
  @Prop({ type: Date }) mutedUntil?: Date;
  @Prop({ type: Date }) archivedAt?: Date;
}

export const InboxMembershipSchema = SchemaFactory.createForClass(InboxMembershipEntity);

addIdAfterSave(InboxMembershipSchema);

InboxMembershipSchema.index({ id: 1 }, { unique: true });
InboxMembershipSchema.index({ orgId: 1, conversationId: 1, memberRefId: 1 }, { unique: true });
InboxMembershipSchema.index({ orgId: 1, memberRefId: 1, archivedAt: 1, updatedAt: -1 });
InboxMembershipSchema.index({ orgId: 1, memberRefId: 1, unreadCount: 1 });
