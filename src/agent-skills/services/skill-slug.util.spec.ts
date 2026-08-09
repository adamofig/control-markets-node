import { buildCapabilitySlug, deriveBundleSlug, ensureUniqueSlug, isCapabilitySlug, slugifySegment } from './skill-slug.util';

/**
 * The slug is an address an agent types (`@agent-profile-specs:send-inbox`), so the rules that matter
 * here are about *stability*: reordering a wiki folder or adding an accent must not silently rename
 * a skill and break every profile that referenced it.
 */
describe('skill-slug.util', () => {
  describe('deriveBundleSlug', () => {
    it('names a folder-shaped skill after its folder, not after SKILL.md', () => {
      expect(deriveBundleSlug('control-markets-wiki/10-skills/02-agent-profile-specs/SKILL.md')).toBe('agent-profile-specs');
    });

    it('treats readme.md and index.md as entry points too', () => {
      expect(deriveBundleSlug('10-skills/01-wiki-specs/readme.md')).toBe('wiki-specs');
      expect(deriveBundleSlug('10-skills/04-entities-operations/index.md')).toBe('entities-operations');
    });

    it('is case-insensitive about the entry-point filename', () => {
      expect(deriveBundleSlug('10-skills/03-design-sytem-specs/skill.md')).toBe('design-sytem-specs');
    });

    it('names a single-file skill after its own filename', () => {
      expect(deriveBundleSlug('control-markets-wiki/10-skills/01-mongo-db-connection.md')).toBe('mongo-db-connection');
    });

    it('strips multi-level ordering prefixes', () => {
      expect(deriveBundleSlug('10-skills/03-02-control-markets-api-tasks-skill.md')).toBe('control-markets-api-tasks-skill');
    });

    it('survives a reorder — the ordering prefix is presentation, not identity', () => {
      expect(deriveBundleSlug('10-skills/02-agent-profile-specs/SKILL.md')).toBe(deriveBundleSlug('10-skills/07-agent-profile-specs/SKILL.md'));
    });

    it('normalizes windows separators, trailing slashes and query fragments', () => {
      expect(deriveBundleSlug('10-skills\\02-agent-profile-specs\\SKILL.md?v=2')).toBe('agent-profile-specs');
      expect(deriveBundleSlug('10-skills/02-agent-profile-specs/')).toBe('agent-profile-specs');
    });

    it('folds accents so the same skill never gets two addresses', () => {
      expect(deriveBundleSlug('10-skills/01-integración-notion.md')).toBe('integracion-notion');
    });

    it('returns an empty string when nothing usable is left, so the caller decides', () => {
      expect(deriveBundleSlug('')).toBe('');
      expect(deriveBundleSlug('10-skills/99-/')).toBe('');
    });
  });

  describe('slugifySegment', () => {
    it('collapses separators and trims the edges', () => {
      expect(slugifySegment('  Agent Profile — Specs!! ')).toBe('agent-profile-specs');
    });
  });

  describe('buildCapabilitySlug', () => {
    it('joins bundle and capability with a colon', () => {
      expect(buildCapabilitySlug('agent-profile-specs', 'send-inbox')).toBe('agent-profile-specs:send-inbox');
    });

    it('slugifies both halves so a hand-written frontmatter cannot mint a weird address', () => {
      expect(buildCapabilitySlug('02-Agent Profile Specs', 'Send Inbox')).toBe('agent-profile-specs:send-inbox');
    });

    it('returns empty when either half is missing', () => {
      expect(buildCapabilitySlug('', 'send-inbox')).toBe('');
      expect(buildCapabilitySlug('agent-profile-specs', '')).toBe('');
    });
  });

  it('recognizes a capability slug by its separator', () => {
    expect(isCapabilitySlug('agent-profile-specs:send-inbox')).toBe(true);
    expect(isCapabilitySlug('agent-profile-specs')).toBe(false);
  });

  describe('ensureUniqueSlug', () => {
    it('leaves a free slug untouched', () => {
      expect(ensureUniqueSlug('agent-profile-specs', new Set())).toBe('agent-profile-specs');
    });

    it('suffixes only on a real collision, and keeps counting', () => {
      const taken = new Set(['specs', 'specs-2']);
      expect(ensureUniqueSlug('specs', taken)).toBe('specs-3');
    });
  });
});
