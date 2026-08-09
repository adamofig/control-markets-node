import { foldDuplicateSources, pickCanonicalSource, scoreSourceFreshness } from './skill-migration.util';

/**
 * These rules decide which of a dozen historical copies of the same `.md` becomes the skill everyone
 * reads from, so getting them wrong means the platform serves a 100-character stub as if it were the
 * live instruction. The fixtures mirror the real shapes found in `sources`.
 */
describe('skill-migration.util', () => {
  const CURRENT = {
    id: 'current',
    kind: 'skill',
    workspaceId: 'control-markets',
    relPath: 'control-markets-wiki/10-skills/02-agent-profile-specs/SKILL.md',
    content: 'x'.repeat(17975),
  };

  const LEGACY_STUB = {
    id: 'legacy-stub',
    tag: 'rule',
    sourceUrl: 'file:///Users/adamo/Documents/GitHub/control-markets/wiki_control-markets/10_skills/02-agent-profile-specs/SKILL.md',
    content: 'x'.repeat(152),
  };

  const LEGACY_FULL = {
    id: 'legacy-full',
    tag: 'rule',
    sourceUrl: 'file:///Users/adamo.figueroa/Documents/GitHub/control-markets/control-markets-wiki/10_skills/mongo-db-connection.md',
    content: 'x'.repeat(13149),
  };

  describe('scoreSourceFreshness', () => {
    it('ranks a row written by the current sync contract above every legacy shape', () => {
      expect(scoreSourceFreshness(CURRENT)).toBeGreaterThan(scoreSourceFreshness(LEGACY_FULL));
      expect(scoreSourceFreshness(CURRENT)).toBeGreaterThan(scoreSourceFreshness(LEGACY_STUB));
    });

    it('does not credit an absolute file:// path as a workspace-relative one', () => {
      expect(scoreSourceFreshness({ id: 'a', sourceUrl: 'file:///Users/adamo/x.md' })).toBe(0);
      expect(scoreSourceFreshness({ id: 'b', relPath: 'wiki/10-skills/x.md' })).toBe(2);
    });

    it('does not credit a POSIX absolute path either', () => {
      expect(scoreSourceFreshness({ id: 'a', relPath: '/Users/adamo/x.md' })).toBe(0);
    });
  });

  describe('pickCanonicalSource', () => {
    it('prefers contract conformance over sheer size — a large stale copy is still stale', () => {
      const staleButHuge = { ...LEGACY_FULL, content: 'x'.repeat(99999) };

      expect(pickCanonicalSource([staleButHuge, CURRENT]).id).toBe('current');
    });

    it('falls back to content length when conformance ties, so stubs never win', () => {
      expect(pickCanonicalSource([LEGACY_STUB, LEGACY_FULL]).id).toBe('legacy-full');
    });

    it('falls back to recency when conformance and length tie', () => {
      const older = { id: 'older', content: 'same', updatedAt: '2026-01-01T00:00:00Z' };
      const newer = { id: 'newer', content: 'same', updatedAt: '2026-08-01T00:00:00Z' };

      expect(pickCanonicalSource([older, newer]).id).toBe('newer');
    });

    it('is deterministic when everything ties — a re-run must not swap which id is canonical', () => {
      const a = { id: 'aaa', content: 'same' };
      const b = { id: 'bbb', content: 'same' };

      expect(pickCanonicalSource([a, b]).id).toBe(pickCanonicalSource([b, a]).id);
    });
  });

  describe('foldDuplicateSources', () => {
    const slugOf = (source: any) => source.slug;

    it('folds copies into one group and keeps the loser ids as aliases', () => {
      const folded = foldDuplicateSources(
        [
          { ...CURRENT, orgId: 'org-a', slug: 'agent-profile-specs' } as any,
          { ...LEGACY_STUB, orgId: 'org-a', slug: 'agent-profile-specs' } as any,
        ],
        slugOf,
      );

      const [group] = folded.get('org-a');
      expect(group.canonical.id).toBe('current');
      expect(group.aliasIds).toEqual(['legacy-stub']);
      expect(group.duplicateCount).toBe(2);
    });

    it('never merges across tenants — two orgs owning the same slug own two different skills', () => {
      const folded = foldDuplicateSources(
        [
          { id: 'a', orgId: 'org-a', slug: 'mongo-db-connection', content: 'A' } as any,
          { id: 'b', orgId: 'org-b', slug: 'mongo-db-connection', content: 'B' } as any,
        ],
        slugOf,
      );

      expect(folded.get('org-a')[0].aliasIds).toEqual([]);
      expect(folded.get('org-b')[0].aliasIds).toEqual([]);
      expect(folded.get('org-a')[0].canonical.id).toBe('a');
      expect(folded.get('org-b')[0].canonical.id).toBe('b');
    });

    it('buckets rows without an orgId under their own key instead of leaking them into a tenant', () => {
      const folded = foldDuplicateSources(
        [
          { id: 'orphan', slug: 'mongo-db-connection', content: 'A' } as any,
          { id: 'owned', orgId: 'org-a', slug: 'mongo-db-connection', content: 'B' } as any,
        ],
        slugOf,
      );

      expect(folded.get('')[0].canonical.id).toBe('orphan');
      expect(folded.get('org-a')[0].canonical.id).toBe('owned');
    });

    it('drops rows whose slug cannot be derived rather than grouping them under an empty key', () => {
      const folded = foldDuplicateSources([{ id: 'x', orgId: 'org-a', slug: '' } as any], slugOf);

      expect(folded.has('org-a')).toBe(false);
    });

    it('leaves a single non-duplicated skill with no aliases', () => {
      const folded = foldDuplicateSources([{ ...CURRENT, orgId: 'org-a', slug: 'agent-profile-specs' } as any], slugOf);

      expect(folded.get('org-a')[0].aliasIds).toEqual([]);
      expect(folded.get('org-a')[0].duplicateCount).toBe(1);
    });
  });
});
