import { AgenticProfileService } from './agentic-profile.service';

describe('AgenticProfileService.getLinkedContextResources', () => {
  const profile = {
    id: 'profile-1',
    orgId: 'org-1',
    sources: [{ id: 'source-1' }],
    skills: [{ id: 'skill-1', enabled: true }, { id: 'skill-off', enabled: false }],
    tasks: [{ id: 'task-1' }],
    memories: [{ id: 'memory-1', enabled: true }],
    explorations: [{ id: 'exploration-1', enabled: true }],
  };

  const sourceDocs: Record<string, any> = {
    'source-1': { id: 'source-1', name: 'Source One', description: 'A doc', sourceUrl: '/w/source.md', content: 'SOURCE_CONTENT' },
    'skill-1': { id: 'skill-1', name: 'Skill One', content: 'SKILL_CONTENT' },
    'memory-1': { id: 'memory-1', name: 'Memory One', content: 'MEMORY_CONTENT' },
    'exploration-1': { id: 'exploration-1', name: 'Exploration One', content: 'EXPLORATION_CONTENT' },
    'skill-off': { id: 'skill-off', name: 'Disabled Skill', content: 'SHOULD_NOT_LEAK' },
    'foreign-source': { id: 'foreign-source', name: 'Another Profile Doc', content: 'SHOULD_NOT_LEAK' },
  };

  const taskDocs = [{ id: 'task-1', name: 'Task One', description: 'Do it', status: 'in_progress', content: 'TASK_CONTENT', sourceUrl: '/w/task.md' }];

  function createService() {
    const model = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(profile) }),
      }),
    };
    const sourcesService = {
      findManyByIds: jest.fn().mockImplementation((ids: string[]) => Promise.resolve(ids.map(id => sourceDocs[id]).filter(Boolean))),
    };
    const agentTasksService = {
      executeOperation: jest.fn().mockImplementation(({ query }: any) => Promise.resolve(taskDocs.filter(task => query.id.$in.includes(task.id)))),
    };
    const service = new AgenticProfileService(model as any, {} as any, {} as any, sourcesService as any, agentTasksService as any, {} as any);
    return { service, sourcesService, agentTasksService };
  }

  it('derives the kind from the profile and ignores what the client claims', async () => {
    const { service } = createService();
    // The caller lies twice: a knowledge source labelled as a task, and a task labelled as a skill.
    const resolved = await service.getLinkedContextResources(
      'profile-1',
      [{ id: 'source-1', kind: 'task' }, { id: 'task-1', kind: 'skill' }] as any,
      'org-1',
    );

    expect(resolved[0]).toMatchObject({ id: 'source-1', kind: 'knowledge', content: 'SOURCE_CONTENT' });
    expect(resolved[1]).toMatchObject({ id: 'task-1', kind: 'task', content: 'TASK_CONTENT', status: 'in_progress' });
  });

  it('flags an id the profile does not link instead of throwing', async () => {
    const { service } = createService();
    const resolved = await service.getLinkedContextResources('profile-1', [{ id: 'foreign-source' }, { id: 'source-1' }], 'org-1');

    expect(resolved[0]).toEqual({ id: 'foreign-source', error: 'not-linked' });
    expect(resolved[0].content).toBeUndefined();
    // The valid ref beside it still resolves — one bad attachment must not kill the turn.
    expect(resolved[1].content).toBe('SOURCE_CONTENT');
  });

  it('treats a disabled link as not attachable, matching what the context index shows', async () => {
    const { service } = createService();
    const [resolved] = await service.getLinkedContextResources('profile-1', [{ id: 'skill-off' }], 'org-1');
    expect(resolved).toEqual({ id: 'skill-off', error: 'not-linked' });
  });

  it('resolves every category in at most two queries and keeps the caller order', async () => {
    const { service, sourcesService, agentTasksService } = createService();
    const resolved = await service.getLinkedContextResources(
      'profile-1',
      [{ id: 'memory-1' }, { id: 'task-1' }, { id: 'exploration-1' }, { id: 'skill-1' }, { id: 'source-1' }],
      'org-1',
    );

    expect(resolved.map(r => r.id)).toEqual(['memory-1', 'task-1', 'exploration-1', 'skill-1', 'source-1']);
    expect(resolved.map(r => r.kind)).toEqual(['memory', 'task', 'exploration', 'skill', 'knowledge']);
    expect(sourcesService.findManyByIds).toHaveBeenCalledTimes(1);
    expect(agentTasksService.executeOperation).toHaveBeenCalledTimes(1);
  });

  it('deduplicates repeated refs so a source is never injected twice', async () => {
    const { service } = createService();
    const resolved = await service.getLinkedContextResources('profile-1', [{ id: 'source-1' }, { id: 'source-1' }], 'org-1');
    expect(resolved).toHaveLength(1);
  });

  it('scopes both queries by organization', async () => {
    const { service, sourcesService, agentTasksService } = createService();
    await service.getLinkedContextResources('profile-1', [{ id: 'source-1' }, { id: 'task-1' }], 'org-1');

    expect(sourcesService.findManyByIds).toHaveBeenCalledWith(['source-1'], 'org-1');
    expect(agentTasksService.executeOperation).toHaveBeenCalledWith({ action: 'find', query: { id: { $in: ['task-1'] }, orgId: 'org-1' } });
  });

  it('reports not-found when the link survives but the document is gone', async () => {
    const { service, sourcesService } = createService();
    sourcesService.findManyByIds.mockResolvedValueOnce([]);
    const [resolved] = await service.getLinkedContextResources('profile-1', [{ id: 'source-1' }], 'org-1');
    expect(resolved).toEqual({ id: 'source-1', kind: 'knowledge', error: 'not-found' });
  });

  describe('getLinkedContextResource (single, used by the built-in getProfileSource tool)', () => {
    it('keeps its flat shape', async () => {
      const { service } = createService();
      await expect(service.getLinkedContextResource('profile-1', 'source-1', 'org-1')).resolves.toEqual({
        id: 'source-1',
        name: 'Source One',
        description: 'A doc',
        sourceUrl: '/w/source.md',
        content: 'SOURCE_CONTENT',
      });
    });

    it('still throws for an unlinked id, as its callers expect', async () => {
      const { service } = createService();
      await expect(service.getLinkedContextResource('profile-1', 'foreign-source', 'org-1')).rejects.toThrow(/not linked/);
    });

    it('now reaches tasks too, which the previous implementation rejected', async () => {
      const { service } = createService();
      await expect(service.getLinkedContextResource('profile-1', 'task-1', 'org-1')).resolves.toMatchObject({ content: 'TASK_CONTENT' });
    });
  });
});
