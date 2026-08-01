import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UpdateInboxMembershipDto } from '../dto/inbox.dto';
import { InboxConversationDocument, InboxConversationEntity } from '../schemas/inbox-conversation.schema';
import { InboxMembershipDocument, InboxMembershipEntity } from '../schemas/inbox-membership.schema';
import { InboxMessageDocument, InboxMessageEntity } from '../schemas/inbox-message.schema';
import { InboxConversationService } from './inbox-conversation.service';
import { InboxEventService } from './inbox-event.service';

@Injectable()
export class InboxMembershipService {
  constructor(
    @InjectModel(InboxConversationEntity.name)
    private readonly conversationModel: Model<InboxConversationDocument>,
    @InjectModel(InboxMembershipEntity.name)
    private readonly membershipModel: Model<InboxMembershipDocument>,
    @InjectModel(InboxMessageEntity.name)
    private readonly messageModel: Model<InboxMessageDocument>,
    private readonly conversations: InboxConversationService,
    private readonly events: InboxEventService
  ) {}

  async markAsRead(orgId: string, conversationId: string, memberRefId: string, throughSequence: number): Promise<Record<string, any>> {
    if (!Number.isInteger(throughSequence) || throughSequence < 0) throw new BadRequestException('throughSequence must be a positive integer');
    const conversation = await this.conversationModel.findOne({ orgId, id: conversationId }).lean().exec();
    if (!conversation) throw new ForbiddenException('Conversation is unavailable');

    const membership = await this.membershipModel.findOne({ orgId, conversationId, memberRefId, leftAt: { $exists: false } }).exec();
    if (!membership) throw new ForbiddenException('You are not a member of this conversation');

    const nextSequence = Math.max(membership.lastReadSequence || 0, Math.min(throughSequence, conversation.lastMessageSequence));
    membership.lastReadSequence = nextSequence;
    membership.lastReadAt = new Date();
    membership.unreadCount = await this.messageModel
      .countDocuments({
        orgId,
        conversationId,
        sequence: { $gt: nextSequence },
        senderParticipantId: { $ne: membership.participantId },
        status: { $ne: 'deleted' },
      })
      .exec();
    if (nextSequence > 0) {
      const message = await this.messageModel.findOne({ orgId, conversationId, sequence: nextSequence }).select({ id: 1 }).lean().exec();
      if (message?.id) membership.lastReadMessageId = message.id;
    }
    const saved = await membership.save();
    return this.emitUpdate(orgId, conversationId, saved);
  }

  async update(orgId: string, conversationId: string, memberRefId: string, dto: UpdateInboxMembershipDto): Promise<Record<string, any>> {
    const update: Record<string, any> = {};
    const unset: Record<string, 1> = {};
    if (dto.archived === true) update.archivedAt = new Date();
    if (dto.archived === false) unset.archivedAt = 1;
    if (dto.pinned === true) update.pinnedAt = new Date();
    if (dto.pinned === false) unset.pinnedAt = 1;
    if (dto.mutedUntil === null) unset.mutedUntil = 1;
    if (typeof dto.mutedUntil === 'string') {
      const mutedUntil = new Date(dto.mutedUntil);
      if (Number.isNaN(mutedUntil.getTime())) throw new BadRequestException('mutedUntil must be an ISO date or null');
      update.mutedUntil = mutedUntil;
    }
    if (!Object.keys(update).length && !Object.keys(unset).length) throw new BadRequestException('No membership changes were provided');

    const membership = await this.membershipModel
      .findOneAndUpdate(
        { orgId, conversationId, memberRefId, leftAt: { $exists: false } },
        { ...(Object.keys(update).length ? { $set: update } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
        { new: true }
      )
      .exec();
    if (!membership) throw new ForbiddenException('You are not a member of this conversation');
    return this.emitUpdate(orgId, conversationId, membership);
  }

  private async emitUpdate(orgId: string, conversationId: string, membership: any): Promise<Record<string, any>> {
    const normalized = typeof membership.toObject === 'function' ? membership.toObject() : { ...membership };
    normalized.id = normalized.id || normalized._id?.toString();
    const recipients = await this.conversations.recipientRefIds(orgId, conversationId);
    this.events.emit('inbox.membership.updated', orgId, conversationId, normalized, recipients);
    return normalized;
  }
}
