import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AgentCardService } from '@dataclouder/nest-agent-cards';
import { AgenticProfileService } from '../../agentic-profile/services/agentic-profile.service';
import { IAgenticProfile, IAgenticProfileAcpConfig } from '../../agentic-profile/models/agentic-profile.models';
import { IInboxAgentContext, IInboxParticipantSnapshot } from '../models/inbox.models';
import { InboxActorContext } from './inbox-identity.service';

export interface ResolvedInboxAgentIdentity {
  orgId: string;
  agenticProfileId: string;
  agentCardId: string;
  participant: IInboxParticipantSnapshot;
  agentContext: IInboxAgentContext;
  /** The profile's canonical engine/model defaults — see `acp-default-engine-model.md`. */
  acpConfig?: IAgenticProfileAcpConfig;
  workspaceId?: string;
}

/** An agentic profile offered as a conversation target in the "Nueva conversación" modal. */
export interface InboxAgentSummary {
  agenticProfileId: string;
  agentCardId: string;
  displayName: string;
  title?: string;
  description?: string;
  avatarUrl?: string;
  defaultEngine?: string;
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

  /**
   * Lists the agentic profiles a user can start an Inbox thread with.
   *
   * Only profiles with a linked Agent Card qualify: the card is the identity that becomes the
   * conversation participant, so a profile without one has nothing to show as a sender. The search
   * runs over the profile's own fields — the card is read afterwards, once, for avatar and name.
   */
  async searchAvailableAgents(orgId: string, search = '', limit = 20): Promise<InboxAgentSummary[]> {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const query: Record<string, any> = { orgId, 'agentCard.id': { $exists: true, $ne: '' } };

    const normalizedSearch = search.trim();
    if (normalizedSearch) {
      const regex = new RegExp(this.escapeRegex(normalizedSearch), 'i');
      query.$or = [{ name: regex }, { title: regex }, { description: regex }, { domain: regex }, { 'agentCard.name': regex }];
    }

    const profiles: IAgenticProfile[] = await this.agenticProfiles.executeOperation({ action: 'find', query }).catch(() => []);

    return profiles
      .slice(0, safeLimit)
      .map((profile): InboxAgentSummary | null => {
        const agenticProfileId = profile.id || (profile as any)._id?.toString();
        const agentCardId = profile.agentCard?.id?.trim();
        if (!agenticProfileId || !agentCardId) return null;
        return {
          agenticProfileId,
          agentCardId,
          displayName: profile.agentCard?.name || profile.name || 'Agente',
          title: profile.title,
          description: profile.description,
          avatarUrl: profile.agentCard?.imageUrl,
          defaultEngine: profile.acpConfig?.defaultEngine,
        };
      })
      .filter((agent): agent is InboxAgentSummary => agent !== null);
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        acpConfig: profile.acpConfig,
        workspaceId: (profile as any).workspaceId,
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
          // Seeded from the profile so the thread remembers which engine it was born with. It stays
          // an override point: changing it here never touches the profile default.
          ...(profile.acpConfig?.defaultEngine ? { engine: profile.acpConfig.defaultEngine } : {}),
        },
      },
    };
  }
}
