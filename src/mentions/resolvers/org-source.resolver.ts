import { Injectable } from '@nestjs/common';
import { SourcesService } from '../../agent-tasks/services/sources.service';
import { IMentionOption, IMentionResolver, IMentionScope, IResolvedMention, MentionKind, mentionUri } from '../models/mention.models';

/** Human label for the badge, so a row reads "YouTube" instead of the raw enum value. */
const SOURCE_TYPE_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  web: 'Web',
  webpage: 'Web',
  document: 'Documento',
  text: 'Texto',
  image: 'Imagen',
  video: 'Video',
};

/**
 * Any source of the organization — Randal's ingested videos, analysed pages, uploaded documents.
 *
 * This is **not** a second reader for a second collection: it reads the same `sources` collection as
 * the profile's own knowledge. The whole difference is the check it does *not* do — the link to the
 * active profile — which is why the feature costs a resolver of forty lines and not a subsystem.
 *
 * Consequence worth stating: a link the user disabled on a profile stops being offered as that
 * profile's knowledge but stays reachable here, as an organization source with `via: 'org'`. That is
 * the intended asymmetry — disabling means "not part of what this agent always knows", not
 * "forbidden to ever point at".
 */
@Injectable()
export class OrgSourceMentionResolver implements IMentionResolver {
  readonly kinds: readonly MentionKind[] = ['org_source'];

  constructor(private readonly sourcesService: SourcesService) {}

  async search(query: string, scope: IMentionScope, limit: number): Promise<IMentionOption[]> {
    const docs = await this.sourcesService.searchForMentions(scope.orgId, query, limit);
    return docs.map((doc: any) => ({
      id: doc.id,
      kind: 'org_source' as const,
      name: doc.name || doc.id,
      description: doc.description,
      sourceUrl: doc.sourceUrl,
      via: 'org' as const,
      uri: mentionUri('org_source', doc.id),
      ...(doc.type ? { badge: SOURCE_TYPE_LABELS[String(doc.type).toLowerCase()] || String(doc.type) } : {}),
    }));
  }

  async resolve(ids: string[], scope: IMentionScope): Promise<IResolvedMention[]> {
    if (!ids.length || !scope.orgId) return [];
    const docs = await this.sourcesService.findManyByIds(ids, scope.orgId);

    return (docs || []).map((doc: any) => ({
      id: doc.id,
      kind: 'org_source' as const,
      via: 'org' as const,
      uri: mentionUri('org_source', doc.id),
      name: doc.name,
      description: doc.description,
      sourceUrl: doc.sourceUrl || doc.relPath,
      content: doc.content,
      // The AI-enhanced version is the stand-in when the transcript does not fit the turn's budget.
      // It is only ever used *announced* — see `formatAttachedSourcesBlock`.
      summary: doc.contentEnhancedAI || undefined,
    }));
  }
}
