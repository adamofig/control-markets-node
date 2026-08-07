import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IInboxAgentContext, IInboxContextReference, IInboxParticipantSnapshot, InboxConversationType } from '../models/inbox.models';
import { InboxConversationDocument, InboxConversationEntity } from '../schemas/inbox-conversation.schema';
import { InboxMembershipDocument, InboxMembershipEntity } from '../schemas/inbox-membership.schema';
import { InboxEventService } from './inbox-event.service';

export interface InboxConversationListItem {
  conversation: Record<string, any>;
  membership: Record<string, any>;
}

@Injectable()
export class InboxConversationService {
  constructor(
    @InjectModel(InboxConversationEntity.name)
    private readonly conversationModel: Model<InboxConversationDocument>,
    @InjectModel(InboxMembershipEntity.name)
    private readonly membershipModel: Model<InboxMembershipDocument>,
    private readonly events: InboxEventService
  ) {}

  async getOrCreateDirect(orgId: string, actor: IInboxParticipantSnapshot, target: IInboxParticipantSnapshot): Promise<InboxConversationListItem> {
    if (actor.refId === target.refId) throw new BadRequestException('A direct conversation requires another user');
    const participants = [actor, target].sort((left, right) => left.refId.localeCompare(right.refId));
    const dedupeKey = `direct:${participants.map(item => item.refId).join(':')}`;
    return this.getOrCreate(orgId, 'direct', undefined, participants, dedupeKey, actor.refId);
  }

  async getOrCreateGroup(orgId: string, actor: IInboxParticipantSnapshot, targets: IInboxParticipantSnapshot[], title: string): Promise<InboxConversationListItem> {
    const normalizedTitle = title?.trim();
    if (!normalizedTitle) throw new BadRequestException('Group title is required');
    const unique = new Map([actor, ...targets].map(participant => [participant.refId, participant]));
    const participants = [...unique.values()];
    if (participants.length < 3) throw new BadRequestException('A group conversation requires at least three participants');
    return this.createConversation(orgId, 'group', normalizedTitle, participants, undefined, actor.refId);
  }

  async getOrCreateTask(orgId: string, actor: IInboxParticipantSnapshot, taskId: string, title: string, participants: IInboxParticipantSnapshot[]): Promise<InboxConversationListItem> {
    const unique = this.uniqueParticipants([actor, ...participants]);
    return this.getOrCreate(orgId, 'task', title, unique, `task:${taskId}`, actor.refId, [{ type: 'task', entityId: taskId, relation: 'primary' }]);
  }

  /**
   * One durable thread per (agent card, user) pair, whichever side opened it.
   *
   * `ownerRefId` decides who the returned membership belongs to, so the caller gets its own view:
   * a PAT-delegated send is the agent writing to a user and defaults to the agent, while a user
   * starting the chat from Control Inbox passes its own refId and gets the membership the UI needs.
   */
  async getOrCreateAgent(
    orgId: string,
    agent: IInboxParticipantSnapshot,
    targetUser: IInboxParticipantSnapshot,
    agentContext: IInboxAgentContext,
    ownerRefId = agent.refId
  ): Promise<InboxConversationListItem> {
    if (agent.type !== 'agent_card' || targetUser.type !== 'user') {
      throw new BadRequestException('An agent conversation requires one Agent Card and one user');
    }
    if (!agentContext.agentCardId || !agentContext.agenticProfileId || agentContext.agentCardId !== agent.refId) {
      throw new BadRequestException('Agent conversation context does not match its participant');
    }

    const participants = this.uniqueParticipants([agent, targetUser]);
    const dedupeKey = `agent:${agent.refId}:user:${targetUser.refId}`;
    return this.getOrCreate(orgId, 'agent', undefined, participants, dedupeKey, ownerRefId, undefined, agentContext);
  }

  /** Reads a conversation without a membership check — for internal runtimes acting on their own. */
  async findById(orgId: string, conversationId: string): Promise<Record<string, any> | null> {
    const conversation = await this.conversationModel.findOne({ orgId, id: conversationId }).lean().exec();
    return conversation ? this.normalize(conversation) : null;
  }

  /**
   * Persists the ACP session the thread is bound to, so the next turn resumes the CLI conversation
   * instead of paying the cold-start and re-injecting the whole profile context.
   */
  async updateAgentSession(orgId: string, conversationId: string, externalSessionId: string | undefined): Promise<void> {
    await this.conversationModel
      .updateOne(
        { orgId, id: conversationId },
        externalSessionId ? { $set: { 'agentContext.externalSessionId': externalSessionId } } : { $unset: { 'agentContext.externalSessionId': '' } }
      )
      .exec();
  }

  async listForMember(orgId: string, memberRefId: string, options: { limit?: number; filter?: string; search?: string } = {}): Promise<{ items: InboxConversationListItem[] }> {
    const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100);
    const membershipQuery: Record<string, any> = { orgId, memberRefId, leftAt: { $exists: false } };
    if (options.filter === 'archived') membershipQuery.archivedAt = { $exists: true };
    else membershipQuery.archivedAt = { $exists: false };

    const memberships = await this.membershipModel.find(membershipQuery).lean().exec();
    if (!memberships.length) return { items: [] };

    const conversationIds = memberships.map(membership => membership.conversationId);
    const conversationQuery: Record<string, any> = { orgId, id: { $in: conversationIds } };
    if (options.filter && !['all', 'archived'].includes(options.filter)) conversationQuery.type = options.filter;
    if (options.search?.trim()) {
      const regex = new RegExp(this.escapeRegex(options.search.trim()), 'i');
      conversationQuery.$or = [{ title: regex }, { 'participants.displayName': regex }];
    }

    const conversations = await this.conversationModel.find(conversationQuery).sort({ updatedAt: -1 }).limit(limit).lean().exec();
    const membershipByConversation = new Map(memberships.map(membership => [membership.conversationId, membership]));
    return {
      items: conversations.map(conversation => ({
        conversation: this.normalize(conversation),
        membership: this.normalize(membershipByConversation.get(conversation.id)),
      })),
    };
  }

  async getForMember(orgId: string, conversationId: string, memberRefId: string): Promise<InboxConversationListItem> {
    const membership = await this.membershipModel
      .findOne({ orgId, conversationId, memberRefId, leftAt: { $exists: false } })
      .lean()
      .exec();
    if (!membership) throw new ForbiddenException('You are not a member of this conversation');

    const conversation = await this.conversationModel.findOne({ orgId, id: conversationId }).lean().exec();
    if (!conversation) throw new NotFoundException('Conversation not found');
    return { conversation: this.normalize(conversation), membership: this.normalize(membership) };
  }

  async recipientRefIds(orgId: string, conversationId: string): Promise<string[]> {
    const memberships = await this.membershipModel
      .find({ orgId, conversationId, leftAt: { $exists: false } })
      .select({ memberRefId: 1 })
      .lean()
      .exec();
    return memberships.map(item => item.memberRefId);
  }

  private async getOrCreate(
    orgId: string,
    type: InboxConversationType,
    title: string | undefined,
    participants: IInboxParticipantSnapshot[],
    dedupeKey: string,
    ownerRefId: string,
    contexts?: IInboxContextReference[],
    agentContext?: IInboxAgentContext
  ): Promise<InboxConversationListItem> {
    const existing = await this.conversationModel.findOne({ orgId, dedupeKey }).lean().exec();
    if (existing) {
      await this.ensureConversationParticipants(orgId, existing.id, participants);
      await this.ensureMemberships(orgId, existing.id, participants, ownerRefId);
      return this.getForMember(orgId, existing.id, ownerRefId);
    }

    try {
      return await this.createConversation(orgId, type, title, participants, dedupeKey, ownerRefId, contexts, agentContext);
    } catch (error) {
      if ((error as any)?.code !== 11000) throw error;
      const raced = await this.conversationModel.findOne({ orgId, dedupeKey }).lean().exec();
      if (!raced) throw error;
      await this.ensureConversationParticipants(orgId, raced.id, participants);
      await this.ensureMemberships(orgId, raced.id, participants, ownerRefId);
      return this.getForMember(orgId, raced.id, ownerRefId);
    }
  }

  private async createConversation(
    orgId: string,
    type: InboxConversationType,
    title: string | undefined,
    participants: IInboxParticipantSnapshot[],
    dedupeKey: string | undefined,
    ownerRefId: string,
    contexts?: IInboxContextReference[],
    agentContext?: IInboxAgentContext
  ): Promise<InboxConversationListItem> {
    const _id = new Types.ObjectId();
    const conversationId = _id.toHexString();
    const conversation = await new this.conversationModel({
      _id,
      id: conversationId,
      orgId,
      type,
      title,
      status: 'open',
      participants,
      participantRefIds: participants.map(participant => participant.refId),
      contexts,
      agentContext,
      dedupeKey,
      lastMessageSequence: 0,
      messageCount: 0,
    }).save();

    await this.ensureMemberships(orgId, conversationId, participants, ownerRefId);
    const result = await this.getForMember(orgId, conversationId, ownerRefId);
    this.events.emit(
      'inbox.conversation.created',
      orgId,
      conversationId,
      result.conversation,
      participants.map(item => item.refId)
    );
    return result;
  }

  private async ensureMemberships(orgId: string, conversationId: string, participants: IInboxParticipantSnapshot[], ownerRefId: string): Promise<void> {
    await Promise.all(
      participants.map(participant =>
        this.membershipModel
          .updateOne(
            { orgId, conversationId, memberRefId: participant.refId },
            {
              $setOnInsert: {
                id: new Types.ObjectId().toHexString(),
                orgId,
                conversationId,
                participantId: participant.participantId,
                memberType: participant.type,
                memberRefId: participant.refId,
                role: participant.refId === ownerRefId ? 'owner' : participant.type === 'user' ? 'member' : 'agent',
                joinedAt: new Date(),
                lastReadSequence: 0,
                unreadCount: 0,
              },
            },
            { upsert: true }
          )
          .exec()
      )
    );
  }

  private async ensureConversationParticipants(orgId: string, conversationId: string, participants: IInboxParticipantSnapshot[]): Promise<void> {
    const conversation = await this.conversationModel.findOne({ orgId, id: conversationId }).exec();
    if (!conversation) throw new NotFoundException('Conversation not found');
    const merged = this.uniqueParticipants([...(conversation.participants || []), ...participants]);
    if (merged.length === conversation.participants.length) return;
    conversation.participants = merged;
    conversation.participantRefIds = merged.map(participant => participant.refId);
    await conversation.save();
  }

  private uniqueParticipants(participants: IInboxParticipantSnapshot[]): IInboxParticipantSnapshot[] {
    return [...new Map(participants.map(participant => [participant.participantId, participant])).values()];
  }

  private normalize(value: any): Record<string, any> {
    if (!value) return value;
    const object = typeof value.toObject === 'function' ? value.toObject() : { ...value };
    object.id = object.id || object._id?.toString();
    return object;
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
