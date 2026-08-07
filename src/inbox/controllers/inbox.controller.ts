import { BadRequestException, Body, Controller, Get, MessageEvent, Param, Patch, Post, Query, Sse, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AppToken } from '@dataclouder/nest-auth';
import { interval, map, merge, Observable } from 'rxjs';
import { OrgId } from '../../common/org-id.decorator';
import { DecodedToken } from '../../common/token.decorator';
import { ProjectAuthGuard } from '../../user/project-auth.guard';
import { CreateAgentConversationDto, CreateDirectConversationDto, CreateGroupConversationDto, MarkInboxReadDto, SendInboxMessageDto, UpdateInboxMembershipDto } from '../dto/inbox.dto';
import { InboxAgentDispatcherService } from '../services/inbox-agent-dispatcher.service';
import { InboxAgentIdentityService } from '../services/inbox-agent-identity.service';
import { InboxConversationService } from '../services/inbox-conversation.service';
import { InboxEventService } from '../services/inbox-event.service';
import { InboxIdentityService } from '../services/inbox-identity.service';
import { InboxMembershipService } from '../services/inbox-membership.service';
import { InboxMessageService } from '../services/inbox-message.service';

@ApiTags('inbox')
@ApiBearerAuth()
@UseGuards(ProjectAuthGuard)
@Controller('api/inbox')
export class InboxController {
  constructor(
    private readonly identities: InboxIdentityService,
    private readonly agentIdentities: InboxAgentIdentityService,
    private readonly conversations: InboxConversationService,
    private readonly messages: InboxMessageService,
    private readonly memberships: InboxMembershipService,
    private readonly agentDispatcher: InboxAgentDispatcherService,
    private readonly events: InboxEventService
  ) {}

  @Get('participants')
  async listParticipants(@DecodedToken() token: AppToken, @OrgId() requestedOrgId?: string, @Query('search') search = '', @Query('limit') limit = '20') {
    const actor = await this.identities.resolveActor(token, requestedOrgId);
    return this.identities.searchOrganizationUsers(actor.orgId, actor.userRefId, search, Number(limit));
  }

  @Get('agents')
  async listAgents(@DecodedToken() token: AppToken, @OrgId() requestedOrgId?: string, @Query('search') search = '', @Query('limit') limit = '20') {
    const actor = await this.identities.resolveActor(token, requestedOrgId);
    return this.agentIdentities.searchAvailableAgents(actor.orgId, search, Number(limit));
  }

  @Post('conversations/agent')
  async createAgentConversation(@DecodedToken() token: AppToken, @Body() dto: CreateAgentConversationDto, @OrgId() requestedOrgId?: string) {
    const actor = await this.identities.resolveActor(token, requestedOrgId);
    if (!dto?.agenticProfileId?.trim()) throw new BadRequestException('agenticProfileId is required');
    const agent = await this.agentIdentities.resolveInternal(actor.orgId, dto.agenticProfileId);
    // The user opened this thread, so the user owns it and gets its own membership back.
    return this.conversations.getOrCreateAgent(
      actor.orgId,
      agent.participant,
      actor.participant,
      { ...agent.agentContext, agentMode: 'conversational' },
      actor.userRefId
    );
  }

  @Post('conversations/direct')
  async createDirect(@DecodedToken() token: AppToken, @Body() dto: CreateDirectConversationDto, @OrgId() requestedOrgId?: string) {
    const actor = await this.identities.resolveActor(token, requestedOrgId);
    const target = await this.identities.findOrganizationUser(actor.orgId, dto?.userId);
    return this.conversations.getOrCreateDirect(actor.orgId, actor.participant, target);
  }

  @Post('conversations/group')
  async createGroup(@DecodedToken() token: AppToken, @Body() dto: CreateGroupConversationDto, @OrgId() requestedOrgId?: string) {
    const actor = await this.identities.resolveActor(token, requestedOrgId);
    if (!Array.isArray(dto?.userIds)) throw new BadRequestException('userIds must be an array');
    const targets = await Promise.all(dto.userIds.map(userId => this.identities.findOrganizationUser(actor.orgId, userId)));
    return this.conversations.getOrCreateGroup(actor.orgId, actor.participant, targets, dto?.title);
  }

  @Get('conversations')
  async listConversations(@DecodedToken() token: AppToken, @OrgId() requestedOrgId?: string, @Query('limit') limit = '30', @Query('filter') filter = 'all', @Query('search') search = '') {
    const actor = await this.identities.resolveActor(token, requestedOrgId);
    return this.conversations.listForMember(actor.orgId, actor.userRefId, { limit: Number(limit), filter, search });
  }

  @Get('conversations/:conversationId')
  async getConversation(@DecodedToken() token: AppToken, @Param('conversationId') conversationId: string, @OrgId() requestedOrgId?: string) {
    const actor = await this.identities.resolveActor(token, requestedOrgId);
    return this.conversations.getForMember(actor.orgId, conversationId, actor.userRefId);
  }

  @Get('conversations/:conversationId/messages')
  async listMessages(
    @DecodedToken() token: AppToken,
    @Param('conversationId') conversationId: string,
    @OrgId() requestedOrgId?: string,
    @Query('beforeSequence') beforeSequence?: string,
    @Query('limit') limit = '50'
  ) {
    const actor = await this.identities.resolveActor(token, requestedOrgId);
    return this.messages.list(actor.orgId, conversationId, actor.userRefId, beforeSequence ? Number(beforeSequence) : undefined, Number(limit));
  }

  @Post('conversations/:conversationId/messages')
  async sendMessage(@DecodedToken() token: AppToken, @Param('conversationId') conversationId: string, @Body() dto: SendInboxMessageDto, @OrgId() requestedOrgId?: string) {
    const actor = await this.identities.resolveActor(token, requestedOrgId);
    const result = await this.messages.send(actor.orgId, conversationId, actor.userRefId, dto);
    // The reply runs detached: the POST returns as soon as the user's own message is durable, and
    // the agent's answer arrives later over SSE like any other message.
    if (result.agentResponseExpected) {
      void this.agentDispatcher.dispatch(actor.orgId, conversationId, result.message.id, actor.participant.displayName);
    }
    return result;
  }

  @Post('conversations/:conversationId/read')
  async markAsRead(@DecodedToken() token: AppToken, @Param('conversationId') conversationId: string, @Body() dto: MarkInboxReadDto, @OrgId() requestedOrgId?: string) {
    const actor = await this.identities.resolveActor(token, requestedOrgId);
    return this.memberships.markAsRead(actor.orgId, conversationId, actor.userRefId, Number(dto?.throughSequence));
  }

  @Patch('conversations/:conversationId/membership')
  async updateMembership(@DecodedToken() token: AppToken, @Param('conversationId') conversationId: string, @Body() dto: UpdateInboxMembershipDto, @OrgId() requestedOrgId?: string) {
    const actor = await this.identities.resolveActor(token, requestedOrgId);
    return this.memberships.update(actor.orgId, conversationId, actor.userRefId, dto);
  }

  @Sse('events')
  async streamEvents(@DecodedToken() token: AppToken, @OrgId() requestedOrgId?: string): Promise<Observable<MessageEvent>> {
    const actor = await this.identities.resolveActor(token, requestedOrgId);
    const heartbeat = interval(25_000).pipe(map(() => ({ type: 'inbox.ping', data: { occurredAt: new Date().toISOString() } })));
    return merge(this.events.forRecipient(actor.orgId, actor.userRefId), heartbeat);
  }
}
