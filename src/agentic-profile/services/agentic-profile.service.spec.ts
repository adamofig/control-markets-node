import * as fs from 'fs';
import { AgenticProfileService } from './agentic-profile.service';

describe('AgenticProfileService context levels', () => {
  const profile = {
    id: 'profile-1',
    orgId: 'org-1',
    title: 'Context agent',
    description: 'Test profile',
    domain: 'CORE_DOMAIN_RULE',
    contextLevel: 'basic',
    agentCard: { id: 'card-1', name: 'Borges' },
    sources: [{ id: 'source-1' }],
    skills: [{ id: 'skill-1', enabled: true }],
    tasks: [{ id: 'task-pending' }, { id: 'task-done' }],
    memories: [{ id: 'memory-1', enabled: true }],
    explorations: [{ id: 'exploration-1', enabled: true }],
  };

  const resources: Record<string, any> = {
    'source-1': { id: 'source-1', orgId: 'org-1', name: 'Source One', description: 'Source summary', sourceUrl: '/workspace/source.md', content: 'SOURCE_FULL_CONTENT' },
    'skill-1': { id: 'skill-1', orgId: 'org-1', name: 'Skill One', description: 'Skill summary', content: 'SKILL_FULL_CONTENT' },
    'memory-1': { id: 'memory-1', orgId: 'org-1', name: 'Memory One', description: 'Memory summary', content: 'MEMORY_FULL_CONTENT' },
    'exploration-1': { id: 'exploration-1', orgId: 'org-1', name: 'Exploration One', description: 'Exploration summary', content: 'EXPLORATION_FULL_CONTENT' },
  };

  const tasks = [
    { id: 'task-pending', orgId: 'org-1', name: 'Pending Task', status: 'pending', description: 'Pending summary', content: 'PENDING_FULL_CONTENT' },
    { id: 'task-done', orgId: 'org-1', name: 'Done Task', status: 'done', description: 'Done summary', content: 'DONE_FULL_CONTENT' },
  ];

  function createService() {
    const model = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(profile),
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(profile) }),
      }),
    };
    const sourcesService = {
      findManyByIds: jest.fn().mockImplementation((ids: string[]) => Promise.resolve(ids.map(id => resources[id]).filter(Boolean))),
    };
    const agentTasksService = { executeOperation: jest.fn().mockResolvedValue(tasks) };
    // Skills live in their own collection now; the capability index is a second, batched lookup.
    const skillsService = {
      findManyByIds: jest.fn().mockImplementation((ids: string[]) => Promise.resolve(ids.map(id => resources[id]).filter(Boolean))),
      listCapabilitiesByBundleIds: jest.fn().mockResolvedValue(new Map()),
    };
    const agentCardService = {
      findById: jest.fn().mockResolvedValue({ characterCard: { data: { name: 'Borges', instructions: 'IDENTITY_RULES' } } }),
    };
    return new AgenticProfileService(model as any, {} as any, agentCardService as any, sourcesService as any, agentTasksService as any, {} as any, skillsService as any);
  }

  it('BASIC includes identity and resource indexes but omits heavy content and tasks', async () => {
    const markdown = await createService().composeFullContext('profile-1', 'org-1', 'basic');

    expect(markdown).toContain('IDENTITY_RULES');
    expect(markdown).toContain('Source One');
    expect(markdown).toContain('`source-1`');
    expect(markdown).not.toContain('SOURCE_FULL_CONTENT');
    expect(markdown).not.toContain('Pending Task');
    expect(markdown).not.toContain('Memory One');
  });

  it('MEDIUM adds pending tasks and memory indexes without full content', async () => {
    const markdown = await createService().composeFullContext('profile-1', 'org-1', 'medium');

    expect(markdown).toContain('Pending Task');
    expect(markdown).not.toContain('Done Task');
    expect(markdown).toContain('Memory One');
    expect(markdown).not.toContain('MEMORY_FULL_CONTENT');
    expect(markdown).not.toContain('PENDING_FULL_CONTENT');
  });

  it('FULL preserves all linked content and completed tasks', async () => {
    const markdown = await createService().composeFullContext('profile-1', 'org-1', 'full');

    expect(markdown).toContain('SOURCE_FULL_CONTENT');
    expect(markdown).toContain('SKILL_FULL_CONTENT');
    expect(markdown).toContain('MEMORY_FULL_CONTENT');
    expect(markdown).toContain('EXPLORATION_FULL_CONTENT');
    expect(markdown).toContain('PENDING_FULL_CONTENT');
    expect(markdown).toContain('DONE_FULL_CONTENT');
  });
});

/**
 * The context index adapts to who reads it (task 23).
 *
 * The fixtures under `__fixtures__/` were produced by the pre-task-23 implementation itself, with
 * these exact mocks: they are the contract for the callers that do not declare a runtime yet
 * (`mcp-tasks.tools.ts`, `scripts/get-profile-context.ts`, `scripts/verify-full-context.ts`).
 */
describe('AgenticProfileService runtime-aware context', () => {
  const profile = {
    id: 'profile-1',
    orgId: 'org-1',
    title: 'Context agent',
    description: 'Test profile',
    domain: 'CORE_DOMAIN_RULE',
    contextLevel: 'basic',
    agentCard: { id: 'card-1', name: 'Borges' },
    sources: [{ id: 'source-1' }, { id: 'source-2' }],
    skills: [
      { id: 'skill-1', enabled: true },
      { id: 'skill-2', enabled: true },
    ],
    tasks: [{ id: 'task-pending' }],
    memories: [{ id: 'memory-1', enabled: true }],
    explorations: [{ id: 'exploration-1', enabled: true }],
    liveBriefing: 'BRIEFING',
  };

  const resources: Record<string, any> = {
    'source-1': { id: 'source-1', name: 'Source One', description: 'Source summary', sourceUrl: '../../02-references/x.md', relPath: 'wiki/02-references/x.md', content: 'SOURCE_FULL_CONTENT' },
    'source-2': { id: 'source-2', name: 'Source Two', sourceUrl: 'https://example.com/doc', content: 'SOURCE_TWO' },
    'skill-1': { id: 'skill-1', name: 'Skill One', description: 'Skill summary', slug: 'skill-one', relPath: 'wiki/10-skills/skill-one', content: 'SKILL_FULL_CONTENT' },
    'skill-2': { id: 'skill-2', name: 'Skill Two', sourceUrl: 'wiki/10-skills/two.md', content: 'SKILL_TWO' },
    'memory-1': { id: 'memory-1', name: 'Memory One', description: 'Memory summary', relPath: 'wiki/memories/m.md', content: 'MEMORY_FULL_CONTENT' },
    'exploration-1': { id: 'exploration-1', name: 'Exploration One', sourceUrl: '../explorations/e.md', relPath: 'wiki/explorations/e.md', content: 'EXPLORATION_FULL_CONTENT' },
  };

  const tasks = [{ id: 'task-pending', name: 'Pending Task', status: 'pending', description: 'Pending summary', content: 'PENDING' }];
  const capabilities = new Map([['skill-1', [{ slug: 'skill-one:sync', name: 'Sync', triggers: ['sync'] }]]]);

  function createService() {
    const model = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(profile),
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(profile) }),
      }),
    };
    const byIds = jest.fn().mockImplementation((ids: string[]) => Promise.resolve(ids.map(id => resources[id]).filter(Boolean)));
    return new AgenticProfileService(
      model as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ characterCard: { data: { name: 'Borges', instructions: 'IDENTITY_RULES' } } }) } as any,
      { findManyByIds: byIds } as any,
      { executeOperation: jest.fn().mockResolvedValue(tasks) } as any,
      {} as any,
      { findManyByIds: byIds, listCapabilitiesByBundleIds: jest.fn().mockResolvedValue(capabilities) } as any,
    );
  }

  it.each(['basic', 'medium', 'full'])('%s is byte-identical to the pre-task-23 output when no runtime is declared', async level => {
    const markdown = await createService().composeFullContext('profile-1', 'org-1', level as any);
    expect(markdown).toBe(fs.readFileSync(`${__dirname}/__fixtures__/legacy-context.${level}.md`, 'utf8'));
  });

  it('stops naming getSkill and getProfileSource to an ACP engine that has neither', async () => {
    const markdown = await createService().composeFullContext('profile-1', 'org-1', 'basic', { engine: 'agy', tools: [] });

    expect(markdown).not.toContain('getSkill');
    expect(markdown).not.toContain('getProfileSource');
    expect(markdown).toContain('motor `agy`');
  });

  it('stops printing repo paths that engine cannot open, while keeping real URLs', async () => {
    const markdown = await createService().composeFullContext('profile-1', 'org-1', 'basic', { engine: 'agy', tools: [] });

    expect(markdown).not.toContain('../../02-references/x.md');
    expect(markdown).not.toContain('wiki/10-skills/skill-one');
    expect(markdown).toContain('- Ruta/URL: https://example.com/doc');
  });

  it('degrades to full content for the entries it can no longer point at', async () => {
    const markdown = await createService().composeFullContext('profile-1', 'org-1', 'basic', { engine: 'agy', tools: [] });

    expect(markdown).toContain('SOURCE_FULL_CONTENT');
    expect(markdown).toContain('SKILL_FULL_CONTENT');
  });

  it('keeps the built-in harness on its tools, since it does have them', async () => {
    const markdown = await createService().composeFullContext('profile-1', 'org-1', 'basic', {
      engine: 'builtin',
      tools: ['readFile', 'getSkill', 'getProfileSource'],
    });

    expect(markdown).toContain("getSkill('skill-one')");
    expect(markdown).toContain('getProfileSource');
    // Nothing is inlined: the reader can fetch it.
    expect(markdown).not.toContain('SKILL_FULL_CONTENT');
  });
});
