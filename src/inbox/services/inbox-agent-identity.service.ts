import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AgentCardService } from '@dataclouder/nest-agent-cards';
import { AgenticProfileService } from '../../agentic-profile/services/agentic-profile.service';
import { IInboxAgentContext, IInboxParticipantSnapshot } from '../models/inbox.models';
import { InboxActorContext } from './inbox-identity.service';

export interface ResolvedInboxAgentIdentity {
  orgId: string;
  agenticProfileId: string;
  agentCardId: string;
  participant: IInboxParticipantSnapshot;
  agentContext: IInboxAgentContext;
}

@Injectable()
export class InboxAgentIdentityService {
  constructor(
    private readonly agenticProfiles: AgenticProfileService,
    private readonly agentCards: AgentCardService
  ) {}

  async resolveDelegated(actor: InboxActorContext, agenticProfileId: string): Promise<ResolvedInboxAgentIdentity> {
    const resolved = await this.resolve(actor.orgId, agenticProfileId, true);
    const patDelegation = resolved.profile.delegation?.pat;

    if (!patDelegation?.enabled || !patDelegation.allowedUserIds?.includes(actor.userRefId)) {
      throw new ForbiddenException('PAT delegation is not enabled for this user and agentic profile');
    }

    return resolved.identity;
  }

  async resolveInternal(orgId: string, agenticProfileId: string): Promise<ResolvedInboxAgentIdentity> {
    return (await this.resolve(orgId, agenticProfileId, false)).identity;
  }

  private async resolve(orgId: string, agenticProfileId: string, hideUnavailableProfile: boolean): Promise<{ identity: ResolvedInboxAgentIdentity; profile: any }> {
    const normalizedProfileId = agenticProfileId?.trim();
    if (!normalizedProfileId) throw new NotFoundException('Agentic profile was not found');

    const profile = await this.agenticProfiles.findByIdForOrganization(normalizedProfileId, orgId);
    if (!profile) {
      if (hideUnavailableProfile) throw new ForbiddenException('Agentic profile is not available in this organization');
      throw new NotFoundException('Agentic profile was not found in this organization');
    }

    const agentCardId = profile.agentCard?.id?.trim();
    if (!agentCardId) throw new NotFoundException('Agentic profile does not have a linked Agent Card');

    let agentCard: any;
    try {
      agentCard = await this.agentCards.findById(agentCardId);
    } catch {
      throw new NotFoundException('Linked Agent Card was not found');
    }
    if (!agentCard) throw new NotFoundException('Linked Agent Card was not found');
    if (agentCard.orgId !== orgId) throw new ForbiddenException('Linked Agent Card belongs to another organization');

    const resolvedProfileId = profile.id || profile._id?.toString();
    const displayName = agentCard.characterCard?.data?.name || agentCard.name || profile.agentCard?.name || profile.name || 'Agent';
    const avatarUrl = profile.agentCard?.imageUrl || agentCard.assets?.image?.url;

    return {
      profile,
      identity: {
        orgId,
        agenticProfileId: resolvedProfileId,
        agentCardId,
        participant: {
          participantId: `agent:${agentCardId}`,
          type: 'agent_card',
          refId: agentCardId,
          displayName,
          ...(avatarUrl ? { avatarUrl } : {}),
        },
        agentContext: {
          agentMode: 'agentic',
          agentCardId,
          agenticProfileId: resolvedProfileId,
        },
      },
    };
  }
}
