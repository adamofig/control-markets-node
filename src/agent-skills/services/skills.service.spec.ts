import { NotFoundException } from '@nestjs/common';
import { SkillsService } from './skills.service';

/**
 * The point of splitting skills out of `sources` is the *granular* fetch: asking for one capability
 * must not cost the whole bundle, and asking for a bundle must tell the caller how to ask again more
 * narrowly. These tests pin that contract, plus the token-shaped decision that scripts travel as
 * paths and never as content.
 */
describe('SkillsService', () => {
  const BUNDLE = {
    id: 'bundle-1',
    slug: 'agent-profile-specs',
    kind: 'bundle',
    name: 'agent-profile-specs',
    description: 'Crear, editar y sincronizar perfiles agénticos',
    relPath: '10-skills/02-agent-profile-specs',
    files: [{ relPath: 'SKILL.md', role: 'instruction', embedded: true, content: 'SKILL BODY' }],
  };

  const CAPABILITY = {
    id: 'cap-1',
    slug: 'agent-profile-specs:send-inbox',
    kind: 'capability',
    bundleId: 'bundle-1',
    bundleSlug: 'agent-profile-specs',
    name: 'Enviar mensaje por Control Inbox',
    type: 'executable_script',
    triggers: ['inbox', 'notificar'],
    files: [
      { relPath: 'reference/inbox-messaging.md', role: 'reference', embedded: true, content: 'INBOX DOC' },
      { relPath: 'scripts/send-agent-message.js', role: 'script', embedded: false },
    ],
  };

  /**
   * `find` is chainable (`.find().sort().lean().exec()`) while `findOne` is not; the fake mirrors
   * both shapes so the service is exercised as written instead of against a reshaped model.
   */
  function createService(docs: any[]) {
    const chain = (result: any) => {
      const link: any = { exec: jest.fn().mockResolvedValue(result) };
      link.sort = jest.fn().mockReturnValue(link);
      link.lean = jest.fn().mockReturnValue(link);
      return link;
    };

    // Mongo matches a scalar query against an array field by membership (`aliasIds: 'x'` hits a doc
    // whose aliasIds contains 'x'); the fake has to do the same or the alias tests would pass for the
    // wrong reason.
    const matches = (doc: any, query: any): boolean =>
      Object.entries(query).every(([key, value]) => {
        if (key === '$or') return (value as any[]).some(clause => matches(doc, clause));
        const field = doc[key];
        const wanted = value && typeof value === 'object' && '$in' in (value as any) ? (value as any).$in : [value];
        return Array.isArray(field) ? field.some(item => wanted.includes(item)) : wanted.includes(field);
      });

    const model: any = {
      find: jest.fn((query: any) => chain(docs.filter(doc => matches(doc, query)))),
      findOne: jest.fn((query: any) => chain(docs.find(doc => matches(doc, query)) ?? null)),
    };
    return new SkillsService(model, {} as any);
  }

  describe('resolve — the granular fetch', () => {
    it('returns only the capability files, not the bundle body', async () => {
      const service = createService([BUNDLE, CAPABILITY]);

      const resolved = await service.resolve('agent-profile-specs:send-inbox');

      expect(resolved.content).toBe('INBOX DOC');
      expect(resolved.content).not.toContain('SKILL BODY');
      expect(resolved.kind).toBe('capability');
    });

    it('hands back scripts as paths, never as content — that is where the tokens would go', async () => {
      const service = createService([BUNDLE, CAPABILITY]);

      const resolved = await service.resolve('agent-profile-specs:send-inbox');

      expect(resolved.scripts).toEqual(['scripts/send-agent-message.js']);
      expect(resolved.content).not.toContain('send-agent-message');
    });

    it('answers a bundle with its capability index, so a caller who guessed too broadly can narrow down', async () => {
      const service = createService([BUNDLE, CAPABILITY]);

      const resolved = await service.resolve('agent-profile-specs');

      expect(resolved.content).toBe('SKILL BODY');
      expect(resolved.capabilities).toEqual([
        expect.objectContaining({ slug: 'agent-profile-specs:send-inbox', triggers: ['inbox', 'notificar'] }),
      ]);
    });

    it('does not attach a capability index to a capability', async () => {
      const service = createService([BUNDLE, CAPABILITY]);

      expect((await service.resolve('agent-profile-specs:send-inbox')).capabilities).toBeUndefined();
    });

    it('resolves by mongo id as well as by slug, because the UI holds ids and prompts hold slugs', async () => {
      const service = createService([BUNDLE, CAPABILITY]);

      expect((await service.resolve('cap-1')).slug).toBe('agent-profile-specs:send-inbox');
    });

    it('resolves a folded alias id, so a profile pointing at a pre-migration source still works', async () => {
      const service = createService([{ ...BUNDLE, aliasIds: ['legacy-stub', 'legacy-full'] }]);

      expect((await service.resolve('legacy-full')).slug).toBe('agent-profile-specs');
    });

    it('narrows to a single embedded file when `file` is given', async () => {
      const service = createService([BUNDLE, CAPABILITY]);

      const resolved = await service.resolve('agent-profile-specs:send-inbox', undefined, 'reference/inbox-messaging.md');

      expect(resolved.content).toBe('INBOX DOC');
      expect(resolved.file).toBe('reference/inbox-messaging.md');
    });

    it('refuses a file that belongs to another skill instead of leaking it', async () => {
      const service = createService([BUNDLE, CAPABILITY]);

      await expect(service.resolve('agent-profile-specs:send-inbox', undefined, 'SKILL.md')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to serve a non-embedded file as content and points at the workspace instead', async () => {
      const service = createService([BUNDLE, CAPABILITY]);

      await expect(service.resolve('agent-profile-specs:send-inbox', undefined, 'scripts/send-agent-message.js')).rejects.toThrow(/not embedded/);
    });

    it('throws on an unknown slug rather than returning an empty skill', async () => {
      const service = createService([BUNDLE]);

      await expect(service.resolve('does-not-exist')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('scopes the lookup by org, so a slug of another tenant is simply not found', async () => {
      const service = createService([{ ...BUNDLE, orgId: 'org-a' }]);

      await expect(service.resolve('agent-profile-specs', 'org-b')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.resolve('agent-profile-specs', 'org-a')).resolves.toMatchObject({ slug: 'agent-profile-specs' });
    });
  });

  describe('findManyByIds', () => {
    it('matches folded alias ids alongside canonical ones, in a single query', async () => {
      const service = createService([{ ...BUNDLE, orgId: 'org-a', aliasIds: ['legacy-stub'] }]);

      const found = await service.findManyByIds(['legacy-stub'], 'org-a');

      expect(found).toHaveLength(1);
      expect(found[0].slug).toBe('agent-profile-specs');
    });

    it('short-circuits on an empty id list instead of querying for everything', async () => {
      const service = createService([BUNDLE]);

      await expect(service.findManyByIds([], 'org-a')).resolves.toEqual([]);
    });
  });

  describe('composeContent', () => {
    it('a bundle composes ONLY its instruction file — concatenating the folder would rebuild the monolith', () => {
      const service = createService([]);

      const composed = service.composeContent({
        kind: 'bundle',
        files: [
          { relPath: 'SKILL.md', role: 'instruction', embedded: true, content: 'INSTRUCCION' },
          { relPath: 'reference/a.md', role: 'reference', embedded: true, content: 'REFERENCIA' },
        ],
      });

      expect(composed).toBe('INSTRUCCION');
      expect(composed).not.toContain('REFERENCIA');
    });

    it('a capability composes everything it declared — that subset IS its instruction', () => {
      const service = createService([]);

      const composed = service.composeContent({
        kind: 'capability',
        files: [
          { relPath: 'reference/a.md', role: 'reference', embedded: true, content: 'A' },
          { relPath: 'reference/b.md', role: 'reference', embedded: true, content: 'B' },
        ],
      });

      expect(composed).toContain('A');
      expect(composed).toContain('B');
    });

    it('leaves a single-file skill bare, so migrated rows read exactly as they did in `sources`', () => {
      const service = createService([]);

      expect(service.composeContent({ files: [{ relPath: 'SKILL.md', role: 'instruction', embedded: true, content: ' BODY ' }] })).toBe('BODY');
    });

    it('labels each file when several are concatenated — the model must be able to cite the source', () => {
      const service = createService([]);

      const composed = service.composeContent({
        files: [
          { relPath: 'reference/a.md', role: 'reference', embedded: true, content: 'A' },
          { relPath: 'reference/b.md', role: 'reference', embedded: true, content: 'B' },
        ],
      });

      expect(composed).toContain('<!-- reference/a.md -->');
      expect(composed).toContain('<!-- reference/b.md -->');
    });

    it('ignores non-embedded entries and empty bodies', () => {
      const service = createService([]);

      expect(
        service.composeContent({
          files: [
            { relPath: 'scripts/x.js', role: 'script', embedded: false },
            { relPath: 'reference/empty.md', role: 'reference', embedded: true, content: '' },
          ],
        }),
      ).toBe('');
    });
  });

  describe('upsertBundle — the sync entry point', () => {
    /**
     * Model fake with the write surface `upsertBundle` uses. Records every call so the test can assert
     * on *what was written*, which is where the sync's correctness actually lives.
     */
    function createSyncService(existingBundle: any = null) {
      const calls: any = { updates: [], saved: [], deletes: [] };
      const findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(existingBundle) });
      const findOneAndUpdate = jest.fn((query: any, update: any) => {
        calls.updates.push({ query, set: update.$set });
        return { exec: jest.fn().mockResolvedValue({ ...update.$set, id: existingBundle?.id ?? 'bundle-new' }) };
      });
      const deleteMany = jest.fn((query: any) => {
        calls.deletes.push(query);
        return { exec: jest.fn().mockResolvedValue({ deletedCount: 0 }) };
      });

      function Model(this: any, doc: any) {
        Object.assign(this, doc);
        this.id = 'bundle-new';
        this.save = jest.fn().mockResolvedValue({ ...doc, id: 'bundle-new' });
        calls.saved.push(doc);
      }
      (Model as any).findOne = findOne;
      (Model as any).findOneAndUpdate = findOneAndUpdate;
      (Model as any).deleteMany = deleteMany;

      return { service: new SkillsService(Model as any, {} as any), calls };
    }

    const PAYLOAD = {
      slug: 'agent-profile-specs',
      name: 'agent-profile-specs',
      description: 'desc',
      rootRelPath: 'control-markets-wiki/10-skills/02-agent-profile-specs',
      files: [
        { relPath: 'SKILL.md', role: 'instruction' as const, embedded: true, content: 'CUERPO' },
        { relPath: 'reference/inbox-messaging.md', role: 'reference' as const, embedded: true, content: 'INBOX' },
        { relPath: 'scripts/send-agent-message.js', role: 'script' as const, embedded: false },
      ],
      capabilities: [
        {
          slug: 'send-inbox',
          name: 'Enviar por Inbox',
          type: 'executable_script' as const,
          triggers: ['inbox'],
          files: [
            { relPath: 'reference/inbox-messaging.md', role: 'reference' as const, embedded: true, content: 'INBOX' },
            { relPath: 'scripts/send-agent-message.js', role: 'script' as const, embedded: false },
          ],
        },
      ],
    };

    it('prefixes the capability slug with its bundle, giving it the address a prompt uses', async () => {
      const { service, calls } = createSyncService();

      await service.upsertBundle(PAYLOAD, 'org-a', 'control-markets');

      expect(calls.updates[0].query).toEqual({ orgId: 'org-a', slug: 'agent-profile-specs:send-inbox' });
      expect(calls.updates[0].set.bundleSlug).toBe('agent-profile-specs');
    });

    it('stores the bundle body as the instruction alone, not the whole folder', async () => {
      const { service, calls } = createSyncService();

      await service.upsertBundle(PAYLOAD, 'org-a', 'control-markets');

      expect(calls.saved[0].content).toBe('CUERPO');
      expect(calls.saved[0].content).not.toContain('INBOX');
    });

    it('gives the capability only its own files, and never the script body', async () => {
      const { service, calls } = createSyncService();

      await service.upsertBundle(PAYLOAD, 'org-a', 'control-markets');

      const capability = calls.updates[0].set;
      expect(capability.content).toBe('INBOX');
      expect(capability.files.find((file: any) => file.relPath.endsWith('.js')).content).toBeUndefined();
    });

    it('deletes capabilities the frontmatter no longer declares — a stale slug must stop answering', async () => {
      const { service, calls } = createSyncService();

      await service.upsertBundle(PAYLOAD, 'org-a', 'control-markets');

      expect(calls.deletes[0]).toMatchObject({
        orgId: 'org-a',
        kind: 'capability',
        slug: { $nin: ['agent-profile-specs:send-inbox'] },
      });
    });

    it('updates the existing bundle instead of inserting a second one with the same slug', async () => {
      const { service, calls } = createSyncService({ _id: 'oid-1', id: 'bundle-1', aliasIds: ['legacy'] });

      const result = await service.upsertBundle(PAYLOAD, 'org-a', 'control-markets');

      expect(calls.saved).toHaveLength(0);
      expect(result.created).toBe(false);
      // aliasIds are absent from the $set, so the folded historical ids survive the sync.
      const bundleUpdate = calls.updates.find((call: any) => call.query._id === 'oid-1');
      expect(bundleUpdate.set).not.toHaveProperty('aliasIds');
    });

    it('derives a fingerprint from the workspace, never from an absolute path', async () => {
      const { service, calls } = createSyncService();

      await service.upsertBundle(PAYLOAD, 'org-a', 'control-markets');

      expect(calls.saved[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    it('omits the fingerprint when there is no workspace to anchor it', async () => {
      const { service, calls } = createSyncService();

      await service.upsertBundle({ ...PAYLOAD, rootRelPath: undefined }, 'org-a', undefined);

      expect(calls.saved[0].fingerprint).toBeUndefined();
    });

    it('refuses a payload with no slug rather than writing an unaddressable skill', async () => {
      const { service } = createSyncService();

      await expect(service.upsertBundle({ slug: '' } as any, 'org-a')).rejects.toThrow(/no slug/);
    });
  });

  describe('listCatalog', () => {
    it('groups capabilities under their bundle and never returns bodies', async () => {
      const service = createService([{ ...BUNDLE, orgId: 'org-a' }, { ...CAPABILITY, orgId: 'org-a' }]);

      const [entry] = await service.listCatalog('org-a');

      expect(entry.slug).toBe('agent-profile-specs');
      expect(entry.capabilities).toHaveLength(1);
      expect(entry).not.toHaveProperty('content');
      expect(entry.capabilities[0]).not.toHaveProperty('content');
    });

    it('returns a bundle with no capabilities as an empty list, not as undefined', async () => {
      const service = createService([{ ...BUNDLE, orgId: 'org-a' }]);

      expect((await service.listCatalog('org-a'))[0].capabilities).toEqual([]);
    });

    it('never shows a bundle of another tenant', async () => {
      const service = createService([{ ...BUNDLE, orgId: 'org-a' }, { ...CAPABILITY, orgId: 'org-a' }]);

      expect(await service.listCatalog('org-b')).toEqual([]);
    });
  });
});
