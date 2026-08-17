/**
 * Contract of the universal `@mention` system.
 *
 * A mention is an **address**, not a paste. Resolving one today materializes text for the prompt;
 * the same address is what a future action layer will act on (delegate to an agent, run a flow,
 * change a task's status), which is why `uri` and `kind` are part of the contract from the start
 * instead of being derived at the injection site.
 */

/**
 * Where a mention points.
 *
 * The first five are the profile's own linked resources — the categories the mention system shipped
 * with. The last two are organization-wide and reachable from any chat of that organization.
 *
 * `knowledge` and `org_source` read the **same** `sources` collection: they differ in provenance,
 * not in storage. Keeping them apart is what lets the UI say "this is your agent's own document"
 * versus "this is something else in your organization", and what lets an audit tell them apart later.
 */
export type MentionKind = 'knowledge' | 'skill' | 'exploration' | 'memory' | 'task' | 'org_source' | 'agentic_profile';

/** Which door the resolution came through. `profile` means the id was linked to the active profile. */
export type MentionProvenance = 'profile' | 'org';

/**
 * Why a ref did not reach the prompt.
 *
 * There is deliberately no `unauthorized`: telling a caller "this id exists but belongs to another
 * organization" is an existence oracle over every tenant's data. A ref outside the caller's
 * organization is indistinguishable from one that never existed — `not-found` for both, and the
 * server logs the miss.
 */
export type MentionError = 'not-linked' | 'not-found' | 'over-limit';

/** What the client pins to a turn. `kind` routes the lookup; it never authorizes it. */
export interface IMentionRef {
  id: string;
  /** UI hint. Picks which resolver is asked first — the resolver still enforces the organization. */
  kind?: MentionKind;
}

/** A row of the `@` menu. Never carries `content`: a catalog renders labels, not documents. */
export interface IMentionOption {
  id: string;
  kind: MentionKind;
  name: string;
  description?: string;
  sourceUrl?: string;
  via: MentionProvenance;
  /** Stable address, `cm://{kind}/{id}` — survives a rename, unlike the `@Name` in the text. */
  uri: string;
  /** Free-form label the UI may show next to the row (source type, agent title, task status). */
  badge?: string;
}

/** One resolved mention, ready to be rendered into the prompt block. */
export interface IResolvedMention {
  id: string;
  /** Absent only when the ref could not be resolved — see `error`. */
  kind?: MentionKind;
  via?: MentionProvenance;
  uri?: string;
  name?: string;
  description?: string;
  sourceUrl?: string;
  content?: string;
  /**
   * Shorter stand-in used when `content` does not fit the turn's budget. Substituting it is always
   * announced, exactly like truncation — a silently summarized document is worse than a missing one.
   */
  summary?: string;
  /** Only for `task` refs. */
  status?: string;
  error?: MentionError;
}

/**
 * Who is asking and from where.
 *
 * `orgId` is resolved by the server from the request context (`req.ctx.orgId`, validated against
 * Mongo membership by `OrgContextGuard`). It never comes from a request body — see doc 07 of the
 * security wiki: the client may *ask* for an organization by header, never *assert* one.
 */
export interface IMentionScope {
  orgId: string;
  /** The profile whose chat this is, when there is one. Enables the `profile` door. */
  profileId?: string;
}

/**
 * One resource family, plugged into the registry.
 *
 * Adding `storage_assets`, `channel_identities` or `blog_entries` later means writing one of these
 * and listing it in `MentionsModule` — the service, the controller and the prompt formatter stay shut.
 */
export interface IMentionResolver {
  /** Kinds this resolver answers for. A kind belongs to exactly one resolver. */
  readonly kinds: readonly MentionKind[];
  /** Catalog rows for the `@` menu. Must filter by `scope.orgId` and project away heavy fields. */
  search(query: string, scope: IMentionScope, limit: number): Promise<IMentionOption[]>;
  /** Materializes the given ids. Ids outside the scope must come back missing, never resolved. */
  resolve(ids: string[], scope: IMentionScope): Promise<IResolvedMention[]>;
}

/** DI token for the resolver list. Multi-provider so a new family is one line in the module. */
export const MENTION_RESOLVERS = 'MENTION_RESOLVERS';

/** Canonical address of a mentionable resource. */
export function mentionUri(kind: MentionKind, id: string): string {
  return `cm://${kind}/${id}`;
}

/** Parses `cm://{kind}/{id}`. Returns null for anything else, including a bare id. */
export function parseMentionUri(uri: string): { kind: MentionKind; id: string } | null {
  const match = /^cm:\/\/([a-z_]+)\/(.+)$/.exec((uri || '').trim());
  if (!match) return null;
  return { kind: match[1] as MentionKind, id: match[2] };
}
