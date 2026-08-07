import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { SendAgentInboxMessageDto, SendInboxMessageDto } from '../dto/inbox.dto';
import { IInboxAgentExecutionSnapshot, INBOX_PROVENANCE_SOURCES, InboxProvenanceSource } from '../models/inbox.models';
import { InboxAgentIdentityService, ResolvedInboxAgentIdentity } from './inbox-agent-identity.service';
import { InboxConversationService } from './inbox-conversation.service';
import { InboxActorContext, InboxIdentityService } from './inbox-identity.service';
import { InboxMessageService } from './inbox-message.service';

@Injectable()
export class InboxAgentMessageService {
  private readonly rateLimitWindowMs = 60_000;
  private readonly rateLimitPerMinute = Math.min(Math.max(Number(process.env.INBOX_AGENT_PAT_RATE_LIMIT_PER_MINUTE) || 30, 1), 300);
  private readonly recentDelegatedSends = new Map<string, number[]>();

  constructor(
    private readonly agentIdentities: InboxAgentIdentityService,
    private readonly userIdentities: InboxIdentityService,
    private readonly conversations: InboxConversationService,
    private readonly messages: InboxMessageService
  ) {}

  async sendDelegated(actor: InboxActorContext, agenticProfileId: string, dto: SendAgentInboxMessageDto) {
    const messageDto = this.toMessageDto(dto);
    this.messages.validate(messageDto);
    const source = this.validateSource(dto?.source?.type || 'rest', dto?.source?.executionId, dto?.source?.engine);
    if (!['rest', 'mcp', 'local'].includes(source.type)) {
      throw new BadRequestException('PAT-delegated messages only accept rest, mcp or local as their source');
    }

    const agent = await this.agentIdentities.resolveDelegated(actor, agenticProfileId);
    const targetUser = await this.userIdentities.findOrganizationUser(actor.orgId, dto?.targetUserId);
    this.assertRateLimit(actor.userRefId, agent.agenticProfileId, targetUser.refId);
    const thread = await this.conversations.getOrCreateAgent(actor.orgId, agent.participant, targetUser, agent.agentContext);

    return this.messages.send(actor.orgId, thread.conversation.id, agent.agentCardId, messageDto, {
      provenance: {
        authType: 'pat_delegation',
        authenticatedUserId: actor.userRefId,
        agenticProfileId: agent.agenticProfileId,
        agentCardId: agent.agentCardId,
        source: source.type,
        executionId: source.executionId,
        engine: source.engine,
      },
    });
  }

  async sendInternalToConversation(
    agent: ResolvedInboxAgentIdentity,
    conversationId: string,
    dto: SendInboxMessageDto,
    source: { type: Exclude<InboxProvenanceSource, 'rest'>; executionId?: string; engine?: string },
    agentExecution?: IInboxAgentExecutionSnapshot
  ) {
    const normalizedSource = this.validateSource(source.type, source.executionId, source.engine);
    return this.messages.send(agent.orgId, conversationId, agent.agentCardId, dto, {
      agentExecution,
      provenance: {
        authType: 'internal_runtime',
        agenticProfileId: agent.agenticProfileId,
        agentCardId: agent.agentCardId,
        source: normalizedSource.type,
        executionId: normalizedSource.executionId,
        engine: normalizedSource.engine,
      },
    });
  }

  private toMessageDto(dto: SendAgentInboxMessageDto): SendInboxMessageDto {
    return {
      clientMessageId: dto?.clientMessageId,
      parts: dto?.parts,
      replyToMessageId: dto?.replyToMessageId,
      groupId: dto?.groupId,
    };
  }

  private validateSource(type: InboxProvenanceSource, executionId?: string, engine?: string) {
    if (!INBOX_PROVENANCE_SOURCES.includes(type)) throw new BadRequestException('Invalid agent message source');
    if (executionId && (typeof executionId !== 'string' || executionId.length > 256)) {
      throw new BadRequestException('executionId must not exceed 256 characters');
    }
    if (engine && (typeof engine !== 'string' || engine.length > 64)) {
      throw new BadRequestException('engine must not exceed 64 characters');
    }
    return { type, executionId: executionId?.trim() || undefined, engine: engine?.trim() || undefined };
  }

  private assertRateLimit(userId: string, agenticProfileId: string, targetUserId: string): void {
    const key = `${userId}:${agenticProfileId}:${targetUserId}`;
    const now = Date.now();
    const activeAttempts = (this.recentDelegatedSends.get(key) || []).filter(timestamp => now - timestamp < this.rateLimitWindowMs);
    if (activeAttempts.length >= this.rateLimitPerMinute) {
      throw new HttpException('Agent message rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
    activeAttempts.push(now);
    this.recentDelegatedSends.set(key, activeAttempts);
    if (this.recentDelegatedSends.size > 10_000) {
      for (const [entryKey, attempts] of this.recentDelegatedSends) {
        if (!attempts.some(timestamp => now - timestamp < this.rateLimitWindowMs)) this.recentDelegatedSends.delete(entryKey);
      }
    }
  }
}
