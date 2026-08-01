import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SendInboxMessageDto } from '../dto/inbox.dto';
import { InboxMessagePart } from '../models/inbox.models';
import { InboxConversationDocument, InboxConversationEntity } from '../schemas/inbox-conversation.schema';
import { InboxMembershipDocument, InboxMembershipEntity } from '../schemas/inbox-membership.schema';
import { InboxMessageDocument, InboxMessageEntity } from '../schemas/inbox-message.schema';
import { InboxConversationService } from './inbox-conversation.service';
import { InboxEventService } from './inbox-event.service';

@Injectable()
export class InboxMessageService {
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

  async list(
    orgId: string,
    conversationId: string,
    memberRefId: string,
    beforeSequence?: number,
    requestedLimit = 50
  ): Promise<{ items: Record<string, any>[]; hasOlder: boolean; oldestSequence?: number; newestSequence?: number }> {
    await this.assertMembership(orgId, conversationId, memberRefId);
    const limit = Math.min(Math.max(Number(requestedLimit) || 50, 1), 100);
    const query: Record<string, any> = { orgId, conversationId };
    if (Number.isFinite(beforeSequence) && Number(beforeSequence) > 0) query.sequence = { $lt: Number(beforeSequence) };

    const page = await this.messageModel
      .find(query)
      .sort({ sequence: -1 })
      .limit(limit + 1)
      .lean()
      .exec();
    const hasOlder = page.length > limit;
    const items = page
      .slice(0, limit)
      .reverse()
      .map(message => this.normalize(message));
    return {
      items,
      hasOlder,
      ...(items.length ? { oldestSequence: items[0].sequence, newestSequence: items[items.length - 1].sequence } : {}),
    };
  }

  async send(orgId: string, conversationId: string, actorRefId: string, dto: SendInboxMessageDto): Promise<{ message: Record<string, any>; agentResponseExpected: boolean }> {
    const membership = await this.assertMembership(orgId, conversationId, actorRefId);
    this.validateMessage(dto);

    const existing = await this.messageModel.findOne({ orgId, conversationId, clientMessageId: dto.clientMessageId }).lean().exec();
    if (existing) return { message: this.normalize(existing), agentResponseExpected: false };

    const conversation = await this.conversationModel.findOneAndUpdate({ orgId, id: conversationId, status: 'open' }, { $inc: { lastMessageSequence: 1 } }, { new: true }).exec();
    if (!conversation) throw new ConflictException('Conversation is closed or unavailable');

    const messageId = new Types.ObjectId().toHexString();
    let message: InboxMessageDocument;
    try {
      message = await new this.messageModel({
        id: messageId,
        orgId,
        conversationId,
        sequence: conversation.lastMessageSequence,
        clientMessageId: dto.clientMessageId,
        senderParticipantId: membership.participantId,
        role: membership.memberType === 'user' ? 'user' : membership.memberType === 'system' ? 'system' : 'assistant',
        kind: membership.memberType === 'system' ? 'system' : 'message',
        status: 'sent',
        parts: dto.parts,
        replyToMessageId: dto.replyToMessageId,
        groupId: dto.groupId,
        origin: { channel: 'internal' },
      }).save();
    } catch (error) {
      if ((error as any)?.code !== 11000) throw error;
      const raced = await this.messageModel.findOne({ orgId, conversationId, clientMessageId: dto.clientMessageId }).lean().exec();
      if (!raced) throw error;
      return { message: this.normalize(raced), agentResponseExpected: false };
    }

    const normalized = this.normalize(message);
    const createdAt = normalized.createdAt || new Date();
    await this.conversationModel
      .updateOne(
        { orgId, id: conversationId },
        {
          $set: {
            lastMessage: {
              messageId,
              sequence: message.sequence,
              senderParticipantId: membership.participantId,
              preview: this.preview(dto.parts),
              contentType: dto.parts[0]?.type || 'event',
              createdAt,
            },
          },
          $inc: { messageCount: 1 },
        }
      )
      .exec();

    await this.membershipModel.updateMany({ orgId, conversationId, memberRefId: { $ne: actorRefId }, leftAt: { $exists: false } }, { $inc: { unreadCount: 1 } }).exec();

    const recipients = await this.conversations.recipientRefIds(orgId, conversationId);
    this.events.emit('inbox.message.created', orgId, conversationId, normalized, recipients);
    return { message: normalized, agentResponseExpected: conversation.type === 'agent' };
  }

  private async assertMembership(orgId: string, conversationId: string, memberRefId: string): Promise<any> {
    const membership = await this.membershipModel
      .findOne({ orgId, conversationId, memberRefId, leftAt: { $exists: false } })
      .lean()
      .exec();
    if (!membership) throw new ForbiddenException('You are not a member of this conversation');
    const conversationExists = await this.conversationModel.exists({ orgId, id: conversationId });
    if (!conversationExists) throw new NotFoundException('Conversation not found');
    return membership;
  }

  private validateMessage(dto: SendInboxMessageDto): void {
    if (!dto?.clientMessageId?.trim() || dto.clientMessageId.length > 128) {
      throw new BadRequestException('clientMessageId must contain between 1 and 128 characters');
    }
    if (!Array.isArray(dto.parts) || !dto.parts.length || dto.parts.length > 20) {
      throw new BadRequestException('A message requires between 1 and 20 parts');
    }
    for (const part of dto.parts) {
      if (!part || typeof part !== 'object') throw new BadRequestException('Invalid message part');
      if (part.type === 'text') {
        if (!part.text?.trim() || part.text.length > 20_000 || !['plain', 'markdown', 'ssml'].includes(part.format)) {
          throw new BadRequestException('Invalid text message part');
        }
      } else if (!['audio', 'image', 'video', 'file'].includes(part.type) || !part.storageAssetId?.trim()) {
        throw new BadRequestException('Asset message parts require a storageAssetId');
      }
    }
  }

  private preview(parts: InboxMessagePart[]): string {
    const text = parts.find(part => part.type === 'text');
    if (text?.type === 'text') return text.text.trim().slice(0, 180);
    const first = parts[0];
    return first?.type === 'audio' ? 'Audio' : first?.type === 'image' ? 'Image' : first?.type === 'video' ? 'Video' : 'File';
  }

  private normalize(value: any): Record<string, any> {
    const object = typeof value?.toObject === 'function' ? value.toObject() : { ...value };
    object.id = object.id || object._id?.toString();
    return object;
  }
}
