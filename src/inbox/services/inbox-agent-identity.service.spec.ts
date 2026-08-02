import { ForbiddenException } from '@nestjs/common';
import { InboxAgentIdentityService } from './inbox-agent-identity.service';

describe('InboxAgentIdentityService', () => {
  const actor = {
    orgId: 'org-1',
    userRefId: 'user-1',
    participant: { participantId: 'user:user-1', type: 'user' as const, refId: 'user-1', displayName: 'Ada' },
  };
  const profile = {
    id: 'profile-1',
    orgId: 'org-1',
    name: 'Borges Profile',
    agentCard: { id: 'card-1', name: 'Borges', imageUrl: 'https://example.com/borges.png' },
    delegation: { pat: { enabled: true, allowedUserIds: ['user-1'] } },
  };
  const card = {
    id: 'card-1',
    orgId: 'org-1',
    name: 'borges',
    characterCard: { data: { name: 'Borges' } },
    assets: { image: { url: 'https://example.com/card.png' } },
  };

  function createService(profileValue: any = profile, cardValue: any = card) {
    const profiles = { findByIdForOrganization: jest.fn().mockResolvedValue(profileValue) };
    const cards = { findById: jest.fn().mockResolvedValue(cardValue) };
    return { service: new InboxAgentIdentityService(profiles as any, cards as any), profiles, cards };
  }

  it('resolves the linked Agent Card and permits an allowlisted PAT user', async () => {
    const { service, profiles, cards } = createService();

    const result = await service.resolveDelegated(actor, 'profile-1');

    expect(profiles.findByIdForOrganization).toHaveBeenCalledWith('profile-1', 'org-1');
    expect(cards.findById).toHaveBeenCalledWith('card-1');
    expect(result).toEqual({
      orgId: 'org-1',
      agenticProfileId: 'profile-1',
      agentCardId: 'card-1',
      participant: {
        participantId: 'agent:card-1',
        type: 'agent_card',
        refId: 'card-1',
        displayName: 'Borges',
        avatarUrl: 'https://example.com/borges.png',
      },
      agentContext: {
        agentMode: 'agentic',
        agentCardId: 'card-1',
        agenticProfileId: 'profile-1',
      },
    });
  });

  it('rejects a PAT user who is not allowlisted', async () => {
    const { service } = createService({
      ...profile,
      delegation: { pat: { enabled: true, allowedUserIds: ['another-user'] } },
    });

    await expect(service.resolveDelegated(actor, 'profile-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a linked Agent Card from another organization', async () => {
    const { service } = createService(profile, { ...card, orgId: 'org-2' });

    await expect(service.resolveDelegated(actor, 'profile-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
