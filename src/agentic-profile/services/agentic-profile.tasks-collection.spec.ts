import { AgenticProfileService } from './agentic-profile.service';

/**
 * Phase 2 of the frontmatter migration. A migrated profile sends its tasks in `collections.tasks`
 * and its Section 6 carries prose instead of checkboxes — if the sync kept reading section 6, every
 * task of that agent would silently disappear from `agent_tasks` on the next run.
 */
describe('AgenticProfileService — task links', () => {
  const service = new AgenticProfileService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  const resolve = (payload: any, sections: any[]) => (service as any).resolveCollectionLinks(payload, sections, 'tasks', 6);

  it('prefers the structured frontmatter tasks[] over the legacy Section 6 checkboxes', () => {
    const structured = [{ label: 'Tarea 17', url: 'tasks/17-sync.md', status: 'in_progress', priority: 3, taskNumber: 17 }];
    const sections = [{ number: 6, links: [{ label: 'vieja', url: 'tasks/01-vieja.md' }] }];

    expect(resolve({ collections: { tasks: structured } }, sections)).toBe(structured);
  });

  it('falls back to Section 6 for agents that have not migrated yet', () => {
    const sections = [{ number: 6, links: [{ label: 'vieja', url: 'tasks/01-vieja.md', status: 'pending' }] }];

    expect(resolve({}, sections)).toEqual(sections[0].links);
  });

  it('treats a declared-but-empty tasks[] as "this agent has no tasks", not as a reason to re-read the section', () => {
    const sections = [{ number: 6, links: [{ label: 'vieja', url: 'tasks/01-vieja.md' }] }];

    expect(resolve({ collections: { tasks: [] } }, sections)).toEqual([]);
  });

  it('survives a Section 6 that is prose only — the shape a migrated profile actually has', () => {
    const sections = [{ number: 6, title: 'Tareas (Task)', content: 'Las tareas se declaran en el frontmatter.' }];

    expect(resolve({ collections: { tasks: [] } }, sections)).toEqual([]);
    expect(resolve({}, sections)).toEqual([]);
  });
});
