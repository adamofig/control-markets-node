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
    const agentCardService = {
      findById: jest.fn().mockResolvedValue({ characterCard: { data: { name: 'Borges', instructions: 'IDENTITY_RULES' } } }),
    };
    return new AgenticProfileService(model as any, {} as any, agentCardService as any, sourcesService as any, agentTasksService as any);
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
