import { AgenticProfileService } from './agentic-profile.service';

/**
 * Skills are declared in two places that must not fight each other: the profile `.md` (now the YAML
 * frontmatter `skills[]`) and the UI catalog. The sync rewrites what the file declares; anything the
 * user attached from the platform has no file to be rewritten from, so it has to survive untouched —
 * otherwise checking a skill in the UI would be silently undone by the next `sync-agent-card` run.
 */
describe('AgenticProfileService — skill links', () => {
  function createService(overrides: { sources?: any; profile?: any } = {}) {
    const sourcesService = {
      findSkillsByOrg: jest.fn().mockResolvedValue([]),
      findManyByIds: jest.fn().mockResolvedValue([]),
      ...(overrides.sources || {}),
    };
    const findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(overrides.profile ?? null) });
    const service = new AgenticProfileService({ findOne } as any, {} as any, {} as any, sourcesService as any, {} as any, {} as any);
    return { service, sourcesService, findOne };
  }

  describe('resolveCollectionLinks (via the sync payload contract)', () => {
    const resolve = (payload: any, sections: any[]) => (createService().service as any).resolveCollectionLinks(payload, sections, 'skills', 4);

    it('prefers the structured frontmatter collection over the legacy Section 4 list', () => {
      const structured = [{ label: 'from-frontmatter', url: 'a.md' }];
      const sections = [{ number: 4, links: [{ label: 'from-section', url: 'b.md' }] }];

      expect(resolve({ collections: { skills: structured } }, sections)).toBe(structured);
    });

    it('falls back to Section 4 for profiles that have not migrated yet', () => {
      const sections = [{ number: 4, links: [{ label: 'from-section', url: 'b.md' }] }];

      expect(resolve({}, sections)).toEqual([{ label: 'from-section', url: 'b.md' }]);
    });

    it('treats an empty frontmatter collection as "declared, and empty" — not as a reason to re-read the section', () => {
      const sections = [{ number: 4, links: [{ label: 'from-section', url: 'b.md' }] }];

      expect(resolve({ collections: { skills: [] } }, sections)).toEqual([]);
    });

    it('returns an empty list when neither shape declares anything', () => {
      expect(resolve({}, [])).toEqual([]);
    });
  });

  describe('listSkillCatalog', () => {
    it('maps the org skill sources to catalog rows', async () => {
      const { service, sourcesService } = createService({
        sources: {
          findSkillsByOrg: jest
            .fn()
            .mockResolvedValue([{ id: 's1', name: 'Mongo', description: 'db', sourceUrl: '../10-skills/mongo.md', updatedAt: '2026-08-08' }, { _id: { toString: () => 's2' }, name: 'Tasks' }]),
        },
      });

      expect(await service.listSkillCatalog('org-1')).toEqual([
        { id: 's1', name: 'Mongo', description: 'db', url: '../10-skills/mongo.md', updatedAt: '2026-08-08' },
        { id: 's2', name: 'Tasks', description: undefined, url: undefined, updatedAt: undefined },
      ]);
      expect(sourcesService.findSkillsByOrg).toHaveBeenCalledWith('org-1');
    });

    it('never queries without an org — an unscoped catalog would leak other tenants', async () => {
      const { service, sourcesService } = createService();

      expect(await service.listSkillCatalog('')).toEqual([]);
      expect(sourcesService.findSkillsByOrg).not.toHaveBeenCalled();
    });
  });

  describe('updateSkillLinks', () => {
    function createProfile(skills: any[]) {
      return { id: 'p1', orgId: 'org-1', skills, save: jest.fn().mockResolvedValue(undefined) };
    }

    it('re-reads labels from the org sources and ignores what the client claims', async () => {
      const profile = createProfile([]);
      const { service } = createService({
        profile,
        sources: { findManyByIds: jest.fn().mockResolvedValue([{ id: 's1', name: 'Real name', description: 'Real description', sourceUrl: 'skills/a.md' }]) },
      });

      const saved = await service.updateSkillLinks('p1', [{ id: 's1', enabled: true } as any], 'org-1');

      expect(saved).toEqual([{ id: 's1', name: 'Real name', description: 'Real description', url: 'skills/a.md', origin: 'platform', enabled: true }]);
      expect(profile.save).toHaveBeenCalled();
    });

    it('drops ids that do not resolve inside the profile organization', async () => {
      const profile = createProfile([]);
      const { service, sourcesService } = createService({
        profile,
        sources: { findManyByIds: jest.fn().mockResolvedValue([{ id: 's1', name: 'Mine' }]) },
      });

      const saved = await service.updateSkillLinks('p1', [{ id: 's1' }, { id: 'other-org-skill' }] as any, 'org-1');

      expect(saved.map(skill => skill.id)).toEqual(['s1']);
      expect(sourcesService.findManyByIds).toHaveBeenCalledWith(['s1', 'other-org-skill'], 'org-1');
    });

    it('keeps origin "markdown" for skills the profile file declares, so the sync still owns them', async () => {
      const profile = createProfile([{ id: 's1', origin: 'markdown', enabled: true }]);
      const { service } = createService({
        profile,
        sources: { findManyByIds: jest.fn().mockResolvedValue([{ id: 's1', name: 'Declared in the .md' }]) },
      });

      const saved = await service.updateSkillLinks('p1', [{ id: 's1', enabled: false }], 'org-1');

      expect(saved[0]).toMatchObject({ origin: 'markdown', enabled: false });
    });

    it('rejects a profile of another organization instead of writing it', async () => {
      const { service, findOne } = createService({ profile: null });

      await expect(service.updateSkillLinks('p1', [], 'other-org')).rejects.toThrow('not found');
      expect(findOne).toHaveBeenCalledWith({ id: 'p1', orgId: 'other-org' });
    });
  });
});
