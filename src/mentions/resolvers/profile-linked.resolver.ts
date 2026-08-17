import { Injectable } from '@nestjs/common';
import { AgenticProfileService } from '../../agentic-profile/services/agentic-profile.service';
import { IMentionOption, IMentionResolver, IMentionScope, IResolvedMention, MentionKind, mentionUri } from '../models/mention.models';

/**
 * The five resources linked to the active agentic profile — the door the mention system shipped with.
 *
 * It is asked **first** for every ref, so a document that is both linked to the profile and present
 * in the organization keeps its precise category (`exploration`, `memory`, …) instead of collapsing
 * into a generic `org_source`, and keeps honouring the profile's own `enabled: false` links.
 *
 * Resolution delegates to `AgenticProfileService.getLinkedContextResources`, which stays the single
 * place that decides what "linked to this profile" means.
 */
@Injectable()
export class ProfileLinkedMentionResolver implements IMentionResolver {
  readonly kinds: readonly MentionKind[] = ['knowledge', 'skill', 'exploration', 'memory', 'task'];

  constructor(private readonly agenticProfileService: AgenticProfileService) {}

  async search(query: string, scope: IMentionScope, limit: number): Promise<IMentionOption[]> {
    if (!scope.profileId) return [];
    const linked = await this.agenticProfileService.listLinkedMentionOptions(scope.profileId, scope.orgId);
    return linked.slice(0, Math.max(limit, linked.length)).map(item => ({
      id: item.id,
      kind: item.kind as MentionKind,
      name: item.name,
      description: item.description,
      sourceUrl: item.sourceUrl,
      via: 'profile' as const,
      uri: mentionUri(item.kind as MentionKind, item.id),
      ...(item.status ? { badge: item.status } : {}),
    }));
  }

  async resolve(ids: string[], scope: IMentionScope): Promise<IResolvedMention[]> {
    if (!ids.length || !scope.profileId) return [];

    const resources = await this.agenticProfileService.getLinkedContextResources(
      scope.profileId,
      ids.map(id => ({ id })),
      scope.orgId,
    );

    // `not-linked` is not an error here, it is a miss: the id may still be an organization resource,
    // and the service will hand it to the next resolver. Only actual hits come back.
    return resources
      .filter(resource => resource.error !== 'not-linked')
      .map(resource => ({
        id: resource.id,
        kind: resource.kind as MentionKind | undefined,
        via: 'profile' as const,
        uri: resource.kind ? mentionUri(resource.kind as MentionKind, resource.id) : undefined,
        name: resource.name,
        description: resource.description,
        sourceUrl: resource.sourceUrl,
        content: resource.content,
        status: resource.status,
        error: resource.error,
      }));
  }
}
