/**
 * Duplicate folding for the `sources → skills` migration.
 *
 * The `sources` collection accumulated the same skill under a dozen ids: every re-sync before the
 * fingerprint contract existed wrote a new row, and the absolute `file://` URLs of the time made two
 * checkouts of the same repo look like two different documents. A dry-run over the live database
 * found 93 skill-like rows collapsing to ~30 real skills — one `.md` alone had 14 copies.
 *
 * Migrating them one-to-one would carry that mess into the collection whose entire purpose is to be
 * the clean, addressable catalog. So duplicates fold into a single bundle, and the loser ids survive
 * as `aliasIds` on the winner (see `ISkill.aliasIds`) because profiles still reference them.
 */

export interface MigratableSource {
  id?: string;
  _id?: any;
  orgId?: string;
  kind?: string;
  tag?: string;
  name?: string;
  content?: string;
  relPath?: string;
  sourceUrl?: string;
  workspaceId?: string;
  updatedAt?: Date | string;
}

/**
 * How closely a row matches the *current* sync contract.
 *
 * A row written by today's sync (`kind: 'skill'`, a `workspaceId`, a workspace-relative path) is the
 * live one; the legacy rows are stubs of 100 characters or stale full copies pinned to someone's
 * absolute home directory. Contract conformance is weighted above size on purpose — a large stale
 * copy is still stale, and the freshest row is the one the wiki will overwrite next sync anyway.
 */
export function scoreSourceFreshness(source: MigratableSource): number {
  let score = 0;
  if (source.kind === 'skill') score += 4;
  if (source.workspaceId) score += 2;

  const path = source.relPath || source.sourceUrl || '';
  const isAbsoluteUrl = /^([a-z]+:)?\/\//i.test(path) || path.startsWith('/');
  if (path && !isAbsoluteUrl) score += 2;

  return score;
}

function toTime(value?: Date | string): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Picks the row that becomes the bundle. Ordered by contract conformance, then content length, then
 * recency — deterministic all the way down so a re-run cannot pick a different winner and silently
 * swap which id is canonical.
 */
export function pickCanonicalSource<T extends MigratableSource>(duplicates: T[]): T {
  return [...duplicates].sort((a, b) => {
    const byScore = scoreSourceFreshness(b) - scoreSourceFreshness(a);
    if (byScore !== 0) return byScore;

    const byLength = (b.content || '').length - (a.content || '').length;
    if (byLength !== 0) return byLength;

    const byRecency = toTime(b.updatedAt) - toTime(a.updatedAt);
    if (byRecency !== 0) return byRecency;

    return String(a.id || a._id).localeCompare(String(b.id || b._id));
  })[0];
}

export interface FoldedSkillGroup<T extends MigratableSource> {
  slug: string;
  canonical: T;
  /** Ids of the folded losers — they become `aliasIds` so existing profile refs keep resolving */
  aliasIds: string[];
  /** Every row of the group, canonical included — callers inspect them to warn about stale winners */
  duplicates: T[];
  duplicateCount: number;
}

/**
 * Groups sources by `(orgId, derived slug)` and folds each group into one bundle.
 *
 * The org is part of the key because slugs are only unique per tenant; two organizations owning a
 * `mongo-db-connection` skill own two different skills and must never be merged.
 */
export function foldDuplicateSources<T extends MigratableSource>(sources: T[], deriveSlug: (source: T) => string): Map<string, FoldedSkillGroup<T>[]> {
  const byOrg = new Map<string, Map<string, T[]>>();

  for (const source of sources) {
    const slug = deriveSlug(source);
    if (!slug) continue;
    const orgKey = source.orgId || '';
    if (!byOrg.has(orgKey)) byOrg.set(orgKey, new Map());
    const bySlug = byOrg.get(orgKey);
    const existing = bySlug.get(slug);
    if (existing) existing.push(source);
    else bySlug.set(slug, [source]);
  }

  const result = new Map<string, FoldedSkillGroup<T>[]>();
  for (const [orgKey, bySlug] of byOrg) {
    const groups: FoldedSkillGroup<T>[] = [];
    for (const [slug, duplicates] of bySlug) {
      const canonical = pickCanonicalSource(duplicates);
      const canonicalId = String(canonical.id || canonical._id);
      const aliasIds = duplicates.map(item => String(item.id || item._id)).filter(id => id && id !== canonicalId);
      groups.push({ slug, canonical, aliasIds, duplicates, duplicateCount: duplicates.length });
    }
    result.set(orgKey, groups.sort((a, b) => a.slug.localeCompare(b.slug)));
  }
  return result;
}
