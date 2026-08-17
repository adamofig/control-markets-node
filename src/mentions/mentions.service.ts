import { Inject, Injectable, Logger } from '@nestjs/common';
import { dedupeMentionOptions, MENTION_SEARCH_LIMIT, rankMentionOptions } from './mention-ranking.util';
import { IMentionOption, IMentionRef, IMentionResolver, IMentionScope, IResolvedMention, MENTION_RESOLVERS, MentionKind } from './models/mention.models';
import { ProfileLinkedMentionResolver } from './resolvers/profile-linked.resolver';

/**
 * Federated catalog and resolution for `@mentions`.
 *
 * ## The two doors, and why they are not symmetric
 *
 * The **profile door** (`ProfileLinkedMentionResolver`) is always asked first and is the only one
 * bound to a single agent. The **organization doors** (everything registered under
 * `MENTION_RESOLVERS`) answer for the whole tenant. They are separate fields rather than one flat
 * list because they answer different questions — "what does this agent have?" versus "what does
 * this organization have?" — and because precedence between them is a rule, not an ordering detail:
 * a profile-linked document keeps its precise category and its `enabled` semantics.
 *
 * ## Where authority lives
 *
 * `scope.orgId` is resolved by the server (`req.ctx.orgId`, validated against Mongo membership by
 * `OrgContextGuard`) and is the only thing that authorizes a read. The `kind` a client sends is a
 * routing hint: it may pick which resolver answers first, never whether the answer is allowed.
 *
 * ## What this deliberately does not do
 *
 * It does not widen what the *model* can reach on its own. The `getProfileSource` tool of the
 * built-in harness still goes through `AgenticProfileService` and still refuses anything not linked
 * to the profile. A person may point anywhere inside their organization; an agent may not wander
 * there by itself.
 */
@Injectable()
export class MentionsService {
  private readonly logger = new Logger(MentionsService.name);

  constructor(
    private readonly profileResolver: ProfileLinkedMentionResolver,
    @Inject(MENTION_RESOLVERS) private readonly orgResolvers: IMentionResolver[],
  ) {}

  /**
   * Rows for the `@` menu, profile resources first.
   *
   * Profile rows lead because they are the ones the user means most of the time, and because the
   * client already holds them in memory: the remote half is what it cannot know on its own.
   */
  async search(query: string, scope: IMentionScope, options: { kinds?: MentionKind[]; limit?: number } = {}): Promise<IMentionOption[]> {
    if (!scope?.orgId) return [];
    const limit = Math.max(1, Math.min(options.limit ?? MENTION_SEARCH_LIMIT, 50));
    const wanted = options.kinds?.length ? new Set(options.kinds) : null;
    const accepts = (resolver: IMentionResolver) => !wanted || resolver.kinds.some(kind => wanted.has(kind));

    const [profileRows, ...orgRows] = await Promise.all([
      accepts(this.profileResolver) ? this.safeSearch(this.profileResolver, query, scope, limit) : Promise.resolve([]),
      ...this.orgResolvers.map(resolver => (accepts(resolver) ? this.safeSearch(resolver, query, scope, limit) : Promise.resolve([]))),
    ]);

    const ranked = [
      ...rankMentionOptions(profileRows, query, limit),
      ...rankMentionOptions(orgRows.flat(), query, limit),
    ];
    const filtered = wanted ? ranked.filter(option => wanted.has(option.kind)) : ranked;
    return dedupeMentionOptions(filtered).slice(0, limit);
  }

  /**
   * Materializes the refs pinned to one turn, in the caller's order, deduplicated.
   *
   * Cost is bounded: one profile lookup plus one query per organization resolver, regardless of how
   * many refs arrive. Resolvers run in parallel and each is asked only for what is still missing.
   */
  async resolve(refs: IMentionRef[], scope: IMentionScope): Promise<IResolvedMention[]> {
    const requested = Array.from(new Set((refs || []).map(ref => ref?.id).filter(Boolean))) as string[];
    if (requested.length === 0) return [];

    if (!scope?.orgId) {
      // Without a validated organization nothing is readable. Failing closed here means a caller
      // that forgot to resolve the context degrades to "no attachments", never to "all tenants".
      this.logger.warn(`Mention resolution without an organization scope; ${requested.length} ref(s) dropped.`);
      return requested.map(id => ({ id, error: 'not-found' as const }));
    }

    const resolved = new Map<string, IResolvedMention>();

    if (scope.profileId) {
      for (const resource of await this.safeResolve(this.profileResolver, requested, scope)) {
        if (resource?.id) resolved.set(resource.id, resource);
      }
    }

    const pending = requested.filter(id => !resolved.has(id));
    if (pending.length > 0) {
      const hintByKind = new Map<string, MentionKind>();
      for (const ref of refs || []) if (ref?.id && ref.kind) hintByKind.set(ref.id, ref.kind);

      const answers = await Promise.all(this.orgResolvers.map(resolver => this.safeResolve(resolver, pending, scope)));

      this.orgResolvers.forEach((resolver, index) => {
        for (const resource of answers[index]) {
          if (!resource?.id) continue;
          const existing = resolved.get(resource.id);
          // Registry order decides ties, except when the client's hint names this resolver's kind:
          // the hint cannot authorize anything, but it can disambiguate an id two collections share.
          const hinted = resource.kind ? hintByKind.get(resource.id) === resource.kind : false;
          if (!existing || hinted) resolved.set(resource.id, resource);
        }
      });
    }

    const missing = requested.filter(id => !resolved.has(id));
    if (missing.length > 0) {
      // Logged, not reported in detail: the client is told `not-found` whether the id belongs to
      // another organization or to nobody, so the response cannot be used to probe other tenants.
      this.logger.warn(`Unresolved mention ref(s) for org ${scope.orgId}: ${missing.join(', ')}`);
    }

    return requested.map(id => resolved.get(id) ?? { id, error: 'not-found' as const });
  }

  /** A resolver that throws degrades its own family, never the whole menu or the whole turn. */
  private async safeSearch(resolver: IMentionResolver, query: string, scope: IMentionScope, limit: number): Promise<IMentionOption[]> {
    try {
      return (await resolver.search(query, scope, limit)) || [];
    } catch (error: any) {
      this.logger.warn(`Mention search failed for [${resolver.kinds.join(', ')}]: ${error?.message}`);
      return [];
    }
  }

  private async safeResolve(resolver: IMentionResolver, ids: string[], scope: IMentionScope): Promise<IResolvedMention[]> {
    try {
      return (await resolver.resolve(ids, scope)) || [];
    } catch (error: any) {
      this.logger.warn(`Mention resolution failed for [${resolver.kinds.join(', ')}]: ${error?.message}`);
      return [];
    }
  }
}
