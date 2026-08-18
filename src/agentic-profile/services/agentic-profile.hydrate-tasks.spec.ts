import { AgenticProfileService } from './agentic-profile.service';

describe('AgenticProfileService.hydrateTaskRefs', () => {
  const liveTasks = [
    { id: 'task-1', orgId: 'org-1', name: 'Renamed in /page/tasks', status: 'in_review', priority: 5, taskNumber: 1, updatedAt: '2026-08-05T10:00:00.000Z' },
    { id: 'task-2', orgId: 'org-1', name: 'Second task', status: 'pending', priority: 3, taskNumber: 2, updatedAt: '2026-08-05T09:00:00.000Z' },
    { id: 'task-foreign', orgId: 'org-2', name: 'Belongs to another tenant', status: 'done', priority: 5, taskNumber: 99 },
  ];

  function createService() {
    const agentTasksService = {
      findRefFieldsByIds: jest.fn().mockImplementation((ids: string[]) => Promise.resolve(liveTasks.filter(task => ids.includes(task.id)))),
    };
    const service = new AgenticProfileService({} as any, {} as any, {} as any, {} as any, agentTasksService as any, {} as any, {} as any);
    return { service, agentTasksService };
  }

  it('refreshes the stale snapshot with the live name, status, priority and taskNumber', async () => {
    const { service } = createService();
    const profile = { orgId: 'org-1', tasks: [{ id: 'task-1', name: 'Old name', status: 'pending', priority: 2 }] };

    const [hydrated] = await service.hydrateTaskRefs([profile]);

    expect(hydrated.tasks[0]).toEqual({
      id: 'task-1',
      name: 'Renamed in /page/tasks',
      status: 'in_review',
      priority: 5,
      taskNumber: 1,
      updatedAt: '2026-08-05T10:00:00.000Z',
    });
  });

  it('fills a priority and taskNumber the ref never had — the profile form writes refs without one', async () => {
    const { service } = createService();
    // `onTaskSelected` in the Angular form stores only { id, name, status }.
    const profile: { orgId: string; tasks: any[] } = { orgId: 'org-1', tasks: [{ id: 'task-2', name: 'Second task', status: 'pending' }] };

    const [hydrated] = await service.hydrateTaskRefs([profile]);

    expect(hydrated.tasks[0].priority).toBe(3);
    expect(hydrated.tasks[0].taskNumber).toBe(2);
  });

  it('resolves every ref of every profile in a single batched query', async () => {
    const { service, agentTasksService } = createService();
    const profiles = [
      { orgId: 'org-1', tasks: [{ id: 'task-1' }, { id: 'task-2' }] },
      { orgId: 'org-1', tasks: [{ id: 'task-2' }] },
    ];

    await service.hydrateTaskRefs(profiles);

    expect(agentTasksService.findRefFieldsByIds).toHaveBeenCalledTimes(1);
    expect(agentTasksService.findRefFieldsByIds).toHaveBeenCalledWith(['task-1', 'task-2', 'task-2']);
  });

  it('does not query at all when no profile links a task', async () => {
    const { service, agentTasksService } = createService();

    await service.hydrateTaskRefs([{ orgId: 'org-1', tasks: [] }, { orgId: 'org-1' } as any]);

    expect(agentTasksService.findRefFieldsByIds).not.toHaveBeenCalled();
  });

  it('keeps the stored snapshot when the task was deleted — hydrating must never prune', async () => {
    const { service } = createService();
    const profile = { orgId: 'org-1', tasks: [{ id: 'task-gone', name: 'Deleted task', status: 'pending', priority: 4 }] };

    const [hydrated] = await service.hydrateTaskRefs([profile]);

    expect(hydrated.tasks[0]).toEqual({ id: 'task-gone', name: 'Deleted task', status: 'pending', priority: 4 });
  });

  it('refuses to overwrite a ref with a task from another organization', async () => {
    const { service } = createService();
    const profile = { orgId: 'org-1', tasks: [{ id: 'task-foreign', name: 'Stored label', status: 'pending', priority: 1 }] };

    const [hydrated] = await service.hydrateTaskRefs([profile]);

    expect(hydrated.tasks[0]).toEqual({ id: 'task-foreign', name: 'Stored label', status: 'pending', priority: 1 });
  });
});
