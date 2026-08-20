// `ai` ships as ESM and this repo's jest does not transform it. The mock is faithful rather than a
// shortcut: `tool()` in the AI SDK is `tool2 => tool2`, a type-inference helper with no runtime
// behavior (@ai-sdk/provider-utils/dist/index.js). Mocking it lets the tool door be tested for the
// only thing that matters here — that it goes through the resolver, and therefore through the
// organization check.
jest.mock('ai', () => ({ tool: (definition: any) => definition }));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CmResourceResolver } from './cm-resource.resolver';
import { CmResourceTools } from './cm-resources.tools';
import { CmResourcesController } from './cm-resources.controller';
import { CM_RESOURCE_MAX_CHARS } from './cm-resource.models';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

/**
 * In-memory doubles that enforce the organization filter the way the real services do — by putting
 * it in the query — instead of asserting that a mock was called with it. The isolation test below
 * is only worth anything if the fakes can actually leak.
 */
function buildFakes() {
  const skills = [
    {
      id: 'sk1',
      orgId: ORG_A,
      slug: 'agent-profile-specs',
      kind: 'bundle',
      name: 'Agent Profile Specs',
      description: 'Cómo sincronizar un perfil',
      relPath: '10-skills/02-agent-profile-specs',
      aliasIds: ['6a52a32f1aac54b41b78f2c1'],
      files: [
        { relPath: 'SKILL.md', role: 'instruction', embedded: true, content: '# SKILL' },
        { relPath: 'scripts/sync-agent-card.js', role: 'script', embedded: false },
      ],
    },
    {
      id: 'sk2',
      orgId: ORG_A,
      slug: 'agent-profile-specs:sync',
      kind: 'capability',
      bundleId: 'sk1',
      name: 'Sync',
      description: 'Sincroniza el perfil',
      files: [{ relPath: 'reference/sync-guide.md', role: 'reference', embedded: true, content: 'guía de sync' }],
    },
  ];

  const skillsService: any = {
    async resolve(slugOrId: string, orgId?: string, file?: string) {
      const skill = skills.find(s => (s.slug === slugOrId || s.id === slugOrId || s.aliasIds?.includes(slugOrId)) && (!orgId || s.orgId === orgId));
      if (!skill) throw new NotFoundException(`Skill '${slugOrId}' not found`);
      const scripts = skill.files.filter(f => !f.embedded).map(f => f.relPath);
      let content: string;
      if (file) {
        const match = skill.files.find(f => f.relPath === file);
        if (!match) throw new NotFoundException(`File '${file}' is not part of skill '${skill.slug}'`);
        if (!match.embedded) throw new NotFoundException(`File '${file}' is referenced by path only (not embedded) — read it from the workspace`);
        content = match.content!;
      } else {
        content = skill.files.filter(f => f.embedded).map(f => f.content).join('\n');
      }
      const capabilities =
        skill.kind === 'bundle'
          ? skills.filter(s => s.bundleId === skill.id).map(s => ({ id: s.id, slug: s.slug, name: s.name, description: s.description }))
          : undefined;
      return { id: skill.id, slug: skill.slug, kind: skill.kind, name: skill.name, description: skill.description, relPath: skill.relPath, content, scripts, ...(capabilities ? { capabilities } : {}) };
    },
  };

  const sources = [
    { id: 'src1', orgId: ORG_A, name: 'Doc de A', description: 'de la org A', content: 'contenido A' },
    { id: 'src2', orgId: ORG_B, name: 'Doc de B', content: 'contenido B' },
    { id: 'big', orgId: ORG_A, name: 'Documento enorme', content: 'x'.repeat(CM_RESOURCE_MAX_CHARS + 500) },
  ];
  const sourcesService: any = {
    async findManyByIds(ids: string[], orgId?: string) {
      return sources.filter(s => ids.includes(s.id) && (!orgId || s.orgId === orgId));
    },
  };

  const tasks = [
    {
      id: 't1',
      orgId: ORG_A,
      name: 'CmResourceResolver',
      description: 'la tarea 24',
      status: 'pending',
      priority: 4,
      taskNumber: 24,
      content: 'Colapsar cinco puertas a una.',
      subtasks: [
        { id: 's1', name: 'cm-uri.util', status: 'done' },
        { id: 's2', name: 'bin/cm', status: 'pending', description: 'sin dependencias' },
      ],
    },
  ];
  const agentTasksService: any = {
    async executeOperation({ query }: any) {
      return tasks.filter(t => t.id === query.id && (!query.orgId || t.orgId === query.orgId));
    },
  };

  const agenticProfileService: any = {
    linked: new Map<string, any>([['src1', { id: 'src1', kind: 'knowledge', name: 'Doc de A (vinculado)', content: 'contenido A' }]]),
    async getLinkedContextResources(profileId: string, refs: Array<{ id: string }>, orgId?: string) {
      if (profileId !== 'p1' || orgId !== ORG_A) throw new Error(`AgenticProfile with ID ${profileId} not found`);
      return refs.map(r => this.linked.get(r.id) ?? { id: r.id, error: 'not-linked' });
    },
    async composeFullContext(profileId: string, orgId?: string) {
      if (profileId !== 'p1' || (orgId && orgId !== ORG_A)) throw new Error(`AgenticProfile with ID ${profileId} not found`);
      return '# Borges\n\ncontexto compilado';
    },
  };

  return { skillsService, sourcesService, agentTasksService, agenticProfileService };
}

const makeResolver = () => {
  const f = buildFakes();
  return new CmResourceResolver(f.skillsService, f.sourcesService, f.agentTasksService, f.agenticProfileService);
};

describe('CmResourceResolver', () => {
  let resolver: CmResourceResolver;
  beforeEach(() => {
    resolver = makeResolver();
  });

  describe('skills', () => {
    it('a bundle brings the index of its capabilities, as addresses', async () => {
      const res = await resolver.read('cm://skill/agent-profile-specs', { orgId: ORG_A });
      expect(res.type).toBe('skill');
      expect(res.children).toEqual([
        { uri: 'cm://skill/agent-profile-specs:sync', name: 'Sync', description: 'Sincroniza el perfil' },
      ]);
    });

    it('a capability brings only its own files, and no children', async () => {
      const res = await resolver.read('cm://skill/agent-profile-specs:sync', { orgId: ORG_A });
      expect(res.type).toBe('capability');
      expect(res.content).toBe('guía de sync');
      expect(res.children).toBeUndefined();
    });

    it('scripts travel as paths, never as content', async () => {
      const res = await resolver.read('cm://skill/agent-profile-specs', { orgId: ORG_A });
      expect(res.scripts).toEqual(['scripts/sync-agent-card.js']);
      expect(res.content).not.toContain('sync-agent-card.js');
    });

    it('asking for a non-embedded file explains it is an executable and gives its path', async () => {
      await expect(resolver.read('cm://skill/agent-profile-specs/scripts/sync-agent-card.js', { orgId: ORG_A })).rejects.toThrow(
        /es un ejecutable.*10-skills\/02-agent-profile-specs\/scripts\/sync-agent-card\.js/s,
      );
    });

    it('a pre-migration aliasId still resolves', async () => {
      const res = await resolver.read('cm://skill/6a52a32f1aac54b41b78f2c1', { orgId: ORG_A });
      expect(res.name).toBe('Agent Profile Specs');
    });
  });

  describe('sources', () => {
    it('resolves through the profile when the run has one', async () => {
      const res = await resolver.read('cm://source/src1', { orgId: ORG_A, profileId: 'p1' });
      expect(res.name).toBe('Doc de A (vinculado)');
    });

    it('falls back to the organization when the document is not linked to the profile', async () => {
      const res = await resolver.read('cm://source/big', { orgId: ORG_A, profileId: 'p1' });
      expect(res.name).toBe('Documento enorme');
    });

    it('the mention dialect reaches the same document', async () => {
      const viaAlias = await resolver.read('cm://knowledge/src1', { orgId: ORG_A });
      expect(viaAlias.uri).toBe('cm://source/src1');
      expect(viaAlias.content).toBe('contenido A');
    });
  });

  describe('tasks', () => {
    it('renders state and the subtask checklist', async () => {
      const res = await resolver.read('cm://task/t1', { orgId: ORG_A });
      expect(res.type).toBe('task');
      expect(res.content).toContain('- Número: `#24`');
      expect(res.content).toContain('- Estado: `pending`');
      expect(res.content).toContain('## Subtareas (1/2)');
      expect(res.content).toContain('- [x] cm-uri.util');
      expect(res.content).toContain('- [ ] bin/cm — sin dependencias');
    });
  });

  describe('profile context', () => {
    it('returns the compiled markdown', async () => {
      const res = await resolver.read('cm://profile/p1/context', { orgId: ORG_A });
      expect(res.type).toBe('profile-context');
      expect(res.content).toContain('contexto compilado');
    });

    it('maps the bare Error of composeFullContext to a 404', async () => {
      await expect(resolver.read('cm://profile/nope/context', { orgId: ORG_A })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('size cap', () => {
    it('marks the cut instead of answering silently incomplete', async () => {
      const res = await resolver.read('cm://source/big', { orgId: ORG_A });
      expect(res.truncated).toBe(true);
      expect(res.content).toContain('Contenido truncado');
      expect(res.content).toContain(`${CM_RESOURCE_MAX_CHARS + 500}`);
    });

    it('leaves a document under the cap untouched', async () => {
      const res = await resolver.read('cm://source/src1', { orgId: ORG_A });
      expect(res.truncated).toBeUndefined();
      expect(res.content).toBe('contenido A');
    });
  });

  describe('the orgId is mandatory, not optional', () => {
    it.each([undefined, '', null])('refuses to read with orgId=%s', async (orgId: any) => {
      await expect(resolver.read('cm://source/src1', { orgId })).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

/**
 * The test that matters most: the same address, asked from another organization, is *not found* —
 * and it has to hold at every door, because a door that skips the resolver is a door that skips the
 * only place the organization is checked.
 *
 * The MCP door is deliberately absent: task 24 wires three doors, and `/mcp` has no per-request
 * identity to scope by until tasks 6 and 25 give it one. Registering `cm_read` there now would add
 * an unscoped surface, which is the opposite of what this task is for.
 */
describe('cross-organization isolation, at every door', () => {
  const CASES: Array<[string, string]> = [
    ['skill', 'cm://skill/agent-profile-specs'],
    ['source', 'cm://source/src1'],
    ['task', 'cm://task/t1'],
    ['profile context', 'cm://profile/p1/context'],
  ];

  describe('door 1 — the resolver', () => {
    it.each(CASES)('%s of org A is not found for org B', async (_label, uri) => {
      await expect(makeResolver().read(uri, { orgId: ORG_B })).rejects.toThrow();
    });

    it('never says "belongs to another organization" — that would be an existence oracle', async () => {
      await expect(makeResolver().read('cm://source/src1', { orgId: ORG_B })).rejects.toThrow(/no existe o no pertenece/);
      await expect(makeResolver().read('cm://source/does-not-exist-at-all', { orgId: ORG_B })).rejects.toThrow(/no existe o no pertenece/);
    });
  });

  describe('door 2 — the Vercel tool', () => {
    it.each(CASES)('%s of org A is not found for org B', async (_label, uri) => {
      const tools = new CmResourceTools(makeResolver()).buildTools({ orgId: ORG_B, profileId: 'p1' });
      await expect(tools.cmRead.execute({ uri }, {} as any)).rejects.toThrow();
    });

    it('the deprecated aliases are scoped by the same check', async () => {
      const tools = new CmResourceTools(makeResolver()).buildTools({ orgId: ORG_B, profileId: 'p1' });
      await expect(tools.getSkill.execute({ slugOrId: 'agent-profile-specs' }, {} as any)).rejects.toThrow();
      await expect(tools.getProfileSource.execute({ sourceId: 'src1' }, {} as any)).rejects.toThrow();
    });

    it('registers no tool at all without an organization', () => {
      expect(new CmResourceTools(makeResolver()).buildTools({ orgId: '' as any })).toEqual({});
    });
  });

  describe('door 3 — the REST controller (which is also what bin/cm calls)', () => {
    it.each(CASES)('%s of org A is not found for org B', async (_label, uri) => {
      const controller = new CmResourcesController(makeResolver());
      await expect(controller.readResource(uri, 'p1', ORG_B)).rejects.toThrow();
    });

    it('the organization comes from the request context, never from a query parameter', async () => {
      const resolver = makeResolver();
      const spy = jest.spyOn(resolver, 'read');
      const controller = new CmResourcesController(resolver);
      // `orgId` is not even in the handler signature as a query param — the only way in is `@OrgId()`.
      await controller.readResource('cm://source/src1', undefined, ORG_A);
      expect(spy).toHaveBeenCalledWith('cm://source/src1', { orgId: ORG_A, profileId: undefined });
    });

    // Task 28: this used to read `orgId || token.userId`. Under the platform master token that is
    // the synthetic `system_root` principal, so a request with no organization became a lookup in a
    // tenant that owns nothing and came back 404 — a lie about the document instead of the truth
    // about the request. `bin/cm` in the homelab container spent three attempts on that 404.
    it('a request with no organization is a 400 about the request, not a 404 about the document', async () => {
      const controller = new CmResourcesController(makeResolver());
      await expect(controller.readResource('cm://source/src1', undefined, undefined)).rejects.toThrow(BadRequestException);
    });

    it('the deprecated aliases keep working for org A — nothing regressed for current consumers', async () => {
      const tools = new CmResourceTools(makeResolver()).buildTools({ orgId: ORG_A, profileId: 'p1' });
      await expect(tools.getSkill.execute({ slugOrId: 'agent-profile-specs' }, {} as any)).resolves.toMatchObject({ type: 'skill' });
      await expect(tools.getProfileSource.execute({ sourceId: 'src1' }, {} as any)).resolves.toMatchObject({ type: 'source' });
    });
  });
});
