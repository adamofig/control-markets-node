import { MentionsService } from './mentions.service';
import { AgenticProfileMentionResolver } from './resolvers/agentic-profile.resolver';
import { OrgSourceMentionResolver } from './resolvers/org-source.resolver';
import { ProfileLinkedMentionResolver } from './resolvers/profile-linked.resolver';

/**
 * The properties these tests hold down are the ones the universal mention system could plausibly
 * lose: tenant isolation (now the only barrier), the precedence of the profile door, and the rule
 * that another agent's directives never travel as context.
 */
describe('MentionsService', () => {
  const ORG = 'org-1';
  const OTHER_ORG = 'org-2';

  /** Two organizations sharing one collection, which is the situation isolation has to survive. */
  const sourceDocs = [
    { id: 'video-1', orgId: ORG, name: 'Desglose SaaS', description: 'Video de YouTube', type: 'youtube', content: 'TRANSCRIPT', contentEnhancedAI: 'RESUMEN' },
    { id: 'linked-doc', orgId: ORG, name: 'Doc del perfil', content: 'ORG_VIEW_OF_LINKED' },
    { id: 'disabled-doc', orgId: ORG, name: 'Exploración apagada', content: 'DISABLED_CONTENT' },
    { id: 'foreign-video', orgId: OTHER_ORG, name: 'Video de otra org', content: 'MUST_NOT_LEAK' },
  ];

  const profileDocs = [
    {
      id: 'cortazar',
      orgId: ORG,
      name: 'Cortazar',
      title: 'Producción de video',
      domain: 'video',
      description: 'Guiones y Remotion',
      skills: [{ id: 's1', name: 'Remotion' }],
      tasks: [{ id: 't1', name: 'Render del trailer', status: 'in_progress' }],
      // Present in the document and expected NEVER to reach the prompt.
      liveBriefing: 'BRIEFING_PRIVADO',
      agentCard: { instructions: 'IGNORA_TUS_INSTRUCCIONES' },
    },
    { id: 'foreign-agent', orgId: OTHER_ORG, name: 'Agente ajeno', title: 'Otro tenant' },
  ];

  function createService(options: { withProfile?: boolean } = { withProfile: true }) {
    const agenticProfileService = {
      // The profile door only knows about what the profile links.
      listLinkedMentionOptions: jest.fn().mockResolvedValue([
        { id: 'linked-doc', kind: 'knowledge', name: 'Doc del perfil', description: 'Vinculado' },
        { id: 'task-1', kind: 'task', name: 'Tarea propia', status: 'pending' },
      ]),
      getLinkedContextResources: jest.fn().mockImplementation((_profileId: string, refs: Array<{ id: string }>) =>
        Promise.resolve(
          refs.map(ref =>
            ref.id === 'linked-doc'
              ? { id: 'linked-doc', kind: 'knowledge', name: 'Doc del perfil', content: 'PROFILE_VIEW_OF_LINKED' }
              : { id: ref.id, error: 'not-linked' },
          ),
        ),
      ),
      searchForMentions: jest.fn().mockImplementation((orgId: string) => Promise.resolve(profileDocs.filter(doc => doc.orgId === orgId))),
      findManyForMentionCards: jest
        .fn()
        .mockImplementation((ids: string[], orgId: string) => Promise.resolve(profileDocs.filter(doc => ids.includes(doc.id) && doc.orgId === orgId))),
    };

    const sourcesService = {
      searchForMentions: jest.fn().mockImplementation((orgId: string) => Promise.resolve(sourceDocs.filter(doc => doc.orgId === orgId))),
      findManyByIds: jest.fn().mockImplementation((ids: string[], orgId?: string) => Promise.resolve(sourceDocs.filter(doc => ids.includes(doc.id) && doc.orgId === orgId))),
    };

    const profileResolver = new ProfileLinkedMentionResolver(agenticProfileService as any);
    const orgResolvers = [new OrgSourceMentionResolver(sourcesService as any), new AgenticProfileMentionResolver(agenticProfileService as any)];
    const service = new MentionsService(profileResolver, orgResolvers as any);
    const scope = { orgId: ORG, ...(options.withProfile ? { profileId: 'borges' } : {}) };
    return { service, scope, agenticProfileService, sourcesService };
  }

  describe('tenant isolation', () => {
    it('does not resolve a source of another organization, and does not say it exists', async () => {
      const { service, scope } = createService();
      const [resolved] = await service.resolve([{ id: 'foreign-video' }], scope);

      // `not-found`, never `unauthorized`: a distinct error would confirm the id exists elsewhere.
      expect(resolved).toEqual({ id: 'foreign-video', error: 'not-found' });
      expect(JSON.stringify(resolved)).not.toContain('MUST_NOT_LEAK');
    });

    it('does not resolve an agent of another organization', async () => {
      const { service, scope } = createService();
      const [resolved] = await service.resolve([{ id: 'foreign-agent', kind: 'agentic_profile' }], scope);
      expect(resolved).toEqual({ id: 'foreign-agent', error: 'not-found' });
    });

    it('fails closed when the request context carries no organization', async () => {
      const { service } = createService();
      const resolved = await service.resolve([{ id: 'video-1' }], { orgId: '' as any, profileId: 'borges' });
      expect(resolved).toEqual([{ id: 'video-1', error: 'not-found' }]);
    });

    it('scopes every organization query by the resolved orgId', async () => {
      const { service, scope, sourcesService } = createService();
      await service.resolve([{ id: 'video-1' }], scope);
      expect(sourcesService.findManyByIds).toHaveBeenCalledWith(['video-1'], ORG);
    });

    it('never lists another tenant in the catalog', async () => {
      const { service, scope } = createService();
      const options = await service.search('', scope, { limit: 50 });
      expect(options.map(option => option.id)).not.toContain('foreign-video');
      expect(options.map(option => option.id)).not.toContain('foreign-agent');
    });
  });

  describe('the two doors', () => {
    it('prefers the profile door, so a linked document keeps its precise kind', async () => {
      const { service, scope } = createService();
      const [resolved] = await service.resolve([{ id: 'linked-doc' }], scope);

      expect(resolved).toMatchObject({ kind: 'knowledge', via: 'profile', content: 'PROFILE_VIEW_OF_LINKED' });
    });

    it('falls through to the organization when the id is not linked to the profile', async () => {
      const { service, scope } = createService();
      const [resolved] = await service.resolve([{ id: 'video-1' }], scope);

      expect(resolved).toMatchObject({ id: 'video-1', kind: 'org_source', via: 'org', content: 'TRANSCRIPT' });
    });

    it('resolves organization refs with no profile at all, for chats that have none', async () => {
      const { service, scope } = createService({ withProfile: false });
      const [resolved] = await service.resolve([{ id: 'video-1' }], scope);
      expect(resolved).toMatchObject({ id: 'video-1', kind: 'org_source' });
    });

    it('reaches a link the profile disabled, as an organization source rather than as its knowledge', async () => {
      const { service, scope } = createService();
      const [resolved] = await service.resolve([{ id: 'disabled-doc' }], scope);

      // Disabling means "not part of what this agent always knows", not "forbidden to ever point at".
      // The provenance says so, so the prompt block can label it.
      expect(resolved).toMatchObject({ kind: 'org_source', via: 'org' });
    });

    it('keeps the caller order and deduplicates repeated refs', async () => {
      const { service, scope } = createService();
      const resolved = await service.resolve([{ id: 'video-1' }, { id: 'linked-doc' }, { id: 'video-1' }], scope);

      expect(resolved.map(r => r.id)).toEqual(['video-1', 'linked-doc']);
    });

    it('surfaces every ref, resolved or not, so a dropped attachment is never silent', async () => {
      const { service, scope } = createService();
      const resolved = await service.resolve([{ id: 'video-1' }, { id: 'does-not-exist' }], scope);

      expect(resolved).toHaveLength(2);
      expect(resolved[1]).toEqual({ id: 'does-not-exist', error: 'not-found' });
    });
  });

  describe('the client hint routes but never authorizes', () => {
    it('ignores a hint that names another family when the id belongs to the profile', async () => {
      const { service, scope } = createService();
      const [resolved] = await service.resolve([{ id: 'linked-doc', kind: 'agentic_profile' }], scope);

      expect(resolved.kind).toBe('knowledge');
    });

    it('cannot use a hint to reach outside the organization', async () => {
      const { service, scope } = createService();
      const [resolved] = await service.resolve([{ id: 'foreign-video', kind: 'org_source' }], scope);
      expect(resolved).toEqual({ id: 'foreign-video', error: 'not-found' });
    });
  });

  describe('agent capability cards', () => {
    it('describes the agent without carrying its directives', async () => {
      const { service, scope } = createService();
      const [resolved] = await service.resolve([{ id: 'cortazar' }], scope);

      expect(resolved.content).toContain('Producción de video');
      expect(resolved.content).toContain('Remotion');
      // The two things that must never travel: the other agent's system prompt and its owner's
      // private standing orders.
      expect(resolved.content).not.toContain('IGNORA_TUS_INSTRUCCIONES');
      expect(resolved.content).not.toContain('BRIEFING_PRIVADO');
    });

    it('tells the reading model the card is not an instruction', async () => {
      const { service, scope } = createService();
      const [resolved] = await service.resolve([{ id: 'cortazar' }], scope);
      expect(resolved.content).toMatch(/no sus instrucciones/i);
    });
  });

  describe('catalog', () => {
    it('puts the profile resources before the organization ones', async () => {
      const { service, scope } = createService();
      const options = await service.search('', scope, { limit: 50 });

      const firstOrgIndex = options.findIndex(option => option.via === 'org');
      const lastProfileIndex = options.map(option => option.via).lastIndexOf('profile');
      expect(lastProfileIndex).toBeLessThan(firstOrgIndex);
    });

    it('stamps a stable cm:// address on every row', async () => {
      const { service, scope } = createService();
      const options = await service.search('', scope, { limit: 50 });
      expect(options.every(option => /^cm:\/\/[a-z_]+\/.+/.test(option.uri))).toBe(true);
    });

    it('restricts the search to the requested kinds', async () => {
      const { service, scope } = createService();
      const options = await service.search('', scope, { kinds: ['agentic_profile'], limit: 50 });

      expect(options.length).toBeGreaterThan(0);
      expect(options.every(option => option.kind === 'agentic_profile')).toBe(true);
    });

    it('ranks a name prefix above a description match', async () => {
      const { service, scope } = createService();
      const options = await service.search('Desglose', scope, { limit: 50 });
      expect(options[0]?.id).toBe('video-1');
    });

    it('degrades one broken resolver instead of emptying the menu', async () => {
      const { service, scope, sourcesService } = createService();
      sourcesService.searchForMentions.mockRejectedValueOnce(new Error('mongo down'));

      const options = await service.search('', scope, { limit: 50 });
      expect(options.some(option => option.kind === 'agentic_profile')).toBe(true);
    });
  });
});
