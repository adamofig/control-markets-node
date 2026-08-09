import { AgenticProfileService } from './agentic-profile.service';

/**
 * Skills are declared in two places that must not fight each other: the profile `.md` (now the YAML
 * frontmatter `skills[]`) and the UI catalog. The sync rewrites what the file declares; anything the
 * user attached from the platform has no file to be rewritten from, so it has to survive untouched —
 * otherwise checking a skill in the UI would be silently undone by the next `sync-agent-card` run.
 */
describe('AgenticProfileService — skill links', () => {
  function createService(overrides: { sources?: any; skills?: any; profile?: any } = {}) {
    const sourcesService = {
      findSkillsByOrg: jest.fn().mockResolvedValue([]),
      findManyByIds: jest.fn().mockResolvedValue([]),
      ...(overrides.sources || {}),
    };
    // Skills moved to their own collection, so the catalog and the link resolution read from here.
    const skillsService = {
      listCatalog: jest.fn().mockResolvedValue([]),
      findManyByIds: jest.fn().mockResolvedValue([]),
      ...(overrides.skills || {}),
    };
    const findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(overrides.profile ?? null) });
    const service = new AgenticProfileService({ findOne } as any, {} as any, {} as any, sourcesService as any, {} as any, {} as any, skillsService as any);
    return { service, sourcesService, skillsService, findOne };
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
    it('maps the org skill bundles to catalog rows, carrying their capability index', async () => {
      const { service, skillsService } = createService({
        skills: {
          listCatalog: jest.fn().mockResolvedValue([
            {
              id: 's1',
              slug: 'mongo-db-connection',
              name: 'Mongo',
              description: 'db',
              relPath: '10-skills/01-mongo-db-connection.md',
              updatedAt: '2026-08-08',
              capabilities: [{ id: 'c1', slug: 'mongo-db-connection:query', name: 'Consultar' }],
            },
          ]),
        },
      });

      expect(await service.listSkillCatalog('org-1')).toEqual([
        {
          id: 's1',
          name: 'Mongo',
          description: 'db',
          url: '10-skills/01-mongo-db-connection.md',
          updatedAt: '2026-08-08',
          capabilities: [{ id: 'c1', slug: 'mongo-db-connection:query', name: 'Consultar' }],
        },
      ]);
      expect(skillsService.listCatalog).toHaveBeenCalledWith('org-1');
    });

    it('never queries without an org — an unscoped catalog would leak other tenants', async () => {
      const { service, skillsService } = createService();

      expect(await service.listSkillCatalog('')).toEqual([]);
      expect(skillsService.listCatalog).not.toHaveBeenCalled();
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
        skills: { findManyByIds: jest.fn().mockResolvedValue([{ id: 's1', name: 'Real name', description: 'Real description', relPath: 'skills/a.md' }]) },
      });

      const saved = await service.updateSkillLinks('p1', [{ id: 's1', enabled: true } as any], 'org-1');

      expect(saved).toEqual([{ id: 's1', name: 'Real name', description: 'Real description', url: 'skills/a.md', origin: 'platform', enabled: true }]);
      expect(profile.save).toHaveBeenCalled();
    });

    it('drops ids that do not resolve inside the profile organization', async () => {
      const profile = createProfile([]);
      const { service, skillsService } = createService({
        profile,
        skills: { findManyByIds: jest.fn().mockResolvedValue([{ id: 's1', name: 'Mine' }]) },
      });

      const saved = await service.updateSkillLinks('p1', [{ id: 's1' }, { id: 'other-org-skill' }] as any, 'org-1');

      expect(saved.map(skill => skill.id)).toEqual(['s1']);
      expect(skillsService.findManyByIds).toHaveBeenCalledWith(['s1', 'other-org-skill'], 'org-1');
    });

    it('keeps origin "markdown" for skills the profile file declares, so the sync still owns them', async () => {
      const profile = createProfile([{ id: 's1', origin: 'markdown', enabled: true }]);
      const { service } = createService({
        profile,
        skills: { findManyByIds: jest.fn().mockResolvedValue([{ id: 's1', name: 'Declared in the .md' }]) },
      });

      const saved = await service.updateSkillLinks('p1', [{ id: 's1', enabled: false }], 'org-1');

      expect(saved[0]).toMatchObject({ origin: 'markdown', enabled: false });
    });

    it('heals a pre-migration reference by storing the canonical id, not the alias the client sent', async () => {
      const profile = createProfile([]);
      const { service } = createService({
        profile,
        skills: { findManyByIds: jest.fn().mockResolvedValue([{ id: 'canonical', aliasIds: ['legacy-id'], name: 'Plegada' }]) },
      });

      const saved = await service.updateSkillLinks('p1', [{ id: 'legacy-id' }] as any, 'org-1');

      expect(saved.map(skill => skill.id)).toEqual(['canonical']);
    });

    it('rejects a profile of another organization instead of writing it', async () => {
      const { service, findOne } = createService({ profile: null });

      await expect(service.updateSkillLinks('p1', [], 'other-org')).rejects.toThrow('not found');
      expect(findOne).toHaveBeenCalledWith({ id: 'p1', orgId: 'other-org' });
    });
  });
});
