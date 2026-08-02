import { BadRequestException } from '@nestjs/common';
import { InboxAgentMessageService } from './inbox-agent-message.service';

describe('InboxAgentMessageService', () => {
  const actor = {
    orgId: 'org-1',
    userRefId: 'user-1',
    participant: { participantId: 'user:user-1', type: 'user' as const, refId: 'user-1', displayName: 'Ada' },
  };
  const agent = {
    orgId: 'org-1',
    agenticProfileId: 'profile-1',
    agentCardId: 'card-1',
    participant: { participantId: 'agent:card-1', type: 'agent_card' as const, refId: 'card-1', displayName: 'Borges' },
    agentContext: { agentMode: 'agentic' as const, agentCardId: 'card-1', agenticProfileId: 'profile-1' },
  };

  function createService() {
    const agentIdentities = { resolveDelegated: jest.fn().mockResolvedValue(agent) };
    const userIdentities = {
      findOrganizationUser: jest.fn().mockResolvedValue({ participantId: 'user:user-2', type: 'user', refId: 'user-2', displayName: 'Grace' }),
    };
    const conversations = { getOrCreateAgent: jest.fn().mockResolvedValue({ conversation: { id: 'conversation-1' }, membership: {} }) };
    const messages = {
      validate: jest.fn(),
      send: jest.fn().mockResolvedValue({ message: { id: 'message-1' }, agentResponseExpected: false }),
    };
    return {
      service: new InboxAgentMessageService(agentIdentities as any, userIdentities as any, conversations as any, messages as any),
      agentIdentities,
      userIdentities,
      conversations,
      messages,
    };
  }

  it('derives the sender from the profile and records the PAT delegator', async () => {
    const { service, conversations, messages } = createService();

    await service.sendDelegated(actor, 'profile-1', {
      targetUserId: 'user-2',
      clientMessageId: 'client-1',
      parts: [{ type: 'text', text: 'Hola', format: 'markdown' }],
      source: { type: 'local', executionId: 'run-1', engine: 'claude' },
      agentCardId: 'forged-card',
      senderParticipantId: 'user:attacker',
      conversationId: 'direct-polito',
    } as any);

    expect(conversations.getOrCreateAgent).toHaveBeenCalledWith('org-1', agent.participant, expect.objectContaining({ refId: 'user-2' }), agent.agentContext);
    expect(messages.send).toHaveBeenCalledWith(
      'org-1',
      'conversation-1',
      'card-1',
      {
        clientMessageId: 'client-1',
        parts: [{ type: 'text', text: 'Hola', format: 'markdown' }],
        replyToMessageId: undefined,
        groupId: undefined,
      },
      {
        provenance: {
          authType: 'pat_delegation',
          authenticatedUserId: 'user-1',
          agenticProfileId: 'profile-1',
          agentCardId: 'card-1',
          source: 'local',
          executionId: 'run-1',
          engine: 'claude',
        },
      }
    );
  });

  it('rejects an internal-only source before creating a conversation', async () => {
    const { service, agentIdentities, conversations } = createService();

    await expect(
      service.sendDelegated(actor, 'profile-1', {
        targetUserId: 'user-2',
        clientMessageId: 'client-1',
        parts: [{ type: 'text', text: 'Hola', format: 'plain' }],
        source: { type: 'heartbeat' },
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(agentIdentities.resolveDelegated).not.toHaveBeenCalled();
    expect(conversations.getOrCreateAgent).not.toHaveBeenCalled();
  });

  it('rate limits repeated delegated sends for the same user, profile and target', async () => {
    const { service } = createService();
    (service as any).rateLimitPerMinute = 1;
    const dto = {
      targetUserId: 'user-2',
      clientMessageId: 'client-1',
      parts: [{ type: 'text' as const, text: 'Hola', format: 'plain' as const }],
    };

    await service.sendDelegated(actor, 'profile-1', dto);
    await expect(service.sendDelegated(actor, 'profile-1', { ...dto, clientMessageId: 'client-2' })).rejects.toMatchObject({ status: 429 });
  });
});
