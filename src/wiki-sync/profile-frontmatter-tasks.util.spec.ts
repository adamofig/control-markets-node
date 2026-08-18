import { hasFrontmatterTasks, upsertProfileTaskEntry } from './profile-frontmatter-tasks.util';

/**
 * The write-back (DB → wiki) used to rewrite a checkbox line with a regex. Now that a migrated
 * profile declares its tasks as YAML, what has to hold is stricter: the entry must be updated in
 * place, everything else in the file — the other frontmatter blocks and the whole body — must come
 * out byte-identical, and a second write of the same state must produce no diff at all.
 */
describe('profile frontmatter tasks[]', () => {
  const profile = [
    '---',
    'name: "Borges"',
    'agentCardId: "card-1"',
    'skills:',
    '  - name: "sync"',
    '    path: "../../10-skills/02-agent-profile-specs/SKILL.md"',
    '    sourceId: "skill-1"',
    'tasks:',
    '  - number: 3',
    '    priority: 3',
    '    status: "pending"',
    '    name: "Bucle agéntico"',
    '    path: "tasks/03-loop.md"',
    '    taskId: "t3"',
    '    description: "Conectar el chat al bucle ReAct."',
    '  - number: 17',
    '    priority: 4',
    '    status: "in_progress"',
    '    name: "Sync YAML"',
    '    path: "tasks/17-sync.md"',
    '    taskId: "t17"',
    'orgId: "org-1"',
    '---',
    '',
    '## 6. Tareas (Task)',
    '',
    'Las tareas se declaran en el frontmatter.',
    '',
  ].join('\n');

  const legacyProfile = ['---', 'name: "Cortazar"', 'orgId: "org-1"', '---', '', '## 6. Tareas', '', '- [ ] #03 **[Algo](tasks/03-algo.md)** — desc', ''].join('\n');

  it('recognizes which profiles have migrated', () => {
    expect(hasFrontmatterTasks(profile)).toBe(true);
    expect(hasFrontmatterTasks(legacyProfile)).toBe(false);
    expect(hasFrontmatterTasks('# no frontmatter at all')).toBe(false);
  });

  it('updates one entry in place and leaves every other line untouched', () => {
    const updated = upsertProfileTaskEntry(profile, 'tasks/03-loop.md', { status: 'done', priority: 3, number: 3, taskId: 't3' });

    expect(updated).not.toBeNull();
    const changed = updated!.split('\n').filter((line, i) => line !== profile.split('\n')[i]);
    expect(changed).toEqual(['    status: "done"']);
  });

  it('is a no-op when the DB and the file already agree', () => {
    expect(upsertProfileTaskEntry(profile, 'tasks/17-sync.md', { status: 'in_progress', priority: 4, number: 17, taskId: 't17' })).toBe(profile);
  });

  it('appends a task born on the platform, so the next CLI sync sees it declared', () => {
    const updated = upsertProfileTaskEntry(profile, 'tasks/27-nueva.md', {
      number: 27,
      priority: 2,
      status: 'pending',
      name: 'Nueva desde la UI',
      taskId: 't27',
    });

    expect(updated).toContain('  - number: 27\n    priority: 2\n    status: "pending"\n    name: "Nueva desde la UI"\n    path: "tasks/27-nueva.md"\n    taskId: "t27"');
    // The block ends where it did: the key that followed `tasks:` is still the next line after it.
    expect(updated).toContain('    taskId: "t27"\norgId: "org-1"');
  });

  it('never blanks a field the DB does not carry', () => {
    const updated = upsertProfileTaskEntry(profile, 'tasks/03-loop.md', { status: 'done', description: undefined, name: undefined });

    expect(updated).toContain('description: "Conectar el chat al bucle ReAct."');
    expect(updated).toContain('name: "Bucle agéntico"');
  });

  it('returns null for a profile that has not migrated, so the caller falls back to Section 6', () => {
    expect(upsertProfileTaskEntry(legacyProfile, 'tasks/03-algo.md', { status: 'done' })).toBeNull();
  });
});
