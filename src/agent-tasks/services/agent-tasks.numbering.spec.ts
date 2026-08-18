import { AgentTasksService } from './agent-tasks.service';
import { AssignedType, IAgentTask, normalizeTaskNumber, resolveTaskNumberScope } from '../models/classes';

/**
 * `taskNumber` is the human-facing handle ("Borges, ejecuta la tarea 7"). What makes it subtle is
 * that it is correlative **per assignee**, and the same assignee is written in three different
 * shapes across the codebase: the markdown sync writes `assignedTo.id = <cardId>`, the task form
 * writes `agentCard.id` + `agenticProfileId`, and legacy human rows written by Angular put the uid
 * in `assignedTo.id` instead of `assignedTo.userId`.
 *
 * If the scope resolver treated those as different assignees, one agent would end up with two
 * independent sequences and two live "tarea 7" — which is exactly the ambiguity the field exists to
 * remove. These cases pin that they all collapse to one sequence.
 */
describe('resolveTaskNumberScope', () => {
  const orgId = 'org-1';

  it('treats the sync shape and the form shape as the same agent sequence', () => {
    const fromSync = resolveTaskNumberScope({ orgId, assignedType: AssignedType.AGENT, assignedTo: { id: 'card-1' } as any });
    const fromForm = resolveTaskNumberScope({ orgId, assignedType: AssignedType.AGENT, agentCard: { id: 'card-1' } as any, agenticProfileId: 'profile-1' });

    expect(fromSync?.key).toBe('card-1');
    expect(fromForm?.key).toBe('card-1');
    // Both must match tasks stored under either path, or half the sequence becomes invisible.
    expect(fromSync?.match.$or).toEqual(expect.arrayContaining([{ 'agentCard.id': 'card-1' }, { 'assignedTo.id': 'card-1' }]));
    expect(fromForm?.match.$or).toEqual(expect.arrayContaining([{ 'agentCard.id': 'card-1' }, { 'assignedTo.id': 'card-1' }]));
  });

  it('matches a human by uid and by the legacy assignedTo.id that holds the same uid', () => {
    const scope = resolveTaskNumberScope({
      orgId,
      assignedType: AssignedType.USER,
      assignedTo: { userId: 'uid-kenya', email: 'cira@gmail.com', name: 'Kenya' },
    });

    expect(scope?.key).toBe('uid-kenya');
    expect(scope?.match.$or).toEqual(
      expect.arrayContaining([{ 'assignedTo.userId': 'uid-kenya' }, { 'assignedTo.id': 'uid-kenya' }, { 'assignedTo.email': 'cira@gmail.com' }])
    );
  });

  it('never mixes humans and agents, even under the same id', () => {
    const user = resolveTaskNumberScope({ orgId, assignedType: AssignedType.USER, assignedTo: { userId: 'x' } as any });
    const agent = resolveTaskNumberScope({ orgId, assignedType: AssignedType.AGENT, assignedTo: { id: 'x' } as any });

    expect(user?.match.assignedType).toBe(AssignedType.USER);
    expect(agent?.match.assignedType).toBe(AssignedType.AGENT);
  });

  it('returns null for an unassigned task and for one without org', () => {
    expect(resolveTaskNumberScope({ orgId, name: 'sin dueño' })).toBeNull();
    expect(resolveTaskNumberScope({ assignedType: AssignedType.AGENT, agentCard: { id: 'card-1' } as any })).toBeNull();
    expect(resolveTaskNumberScope(null)).toBeNull();
  });
});

describe('normalizeTaskNumber', () => {
  it('accepts positive integers however they are written', () => {
    expect(normalizeTaskNumber(7)).toBe(7);
    expect(normalizeTaskNumber('7')).toBe(7);
    expect(normalizeTaskNumber(' 07 ')).toBe(7);
  });

  it('rejects zero, negatives and junk', () => {
    for (const value of [0, -1, 'abc', '', null, undefined]) {
      expect(normalizeTaskNumber(value)).toBeUndefined();
    }
  });
});

describe('AgentTasksService.assignTaskNumber', () => {
  /** Fake collection holding just what the numbering queries read. */
  function createService(existing: { taskNumber?: number }[] = []) {
    const genericModel = {
      findOne: jest.fn().mockReturnValue({
        sort: () => ({
          select: () => ({
            lean: () => ({
              exec: () => Promise.resolve(existing.slice().sort((a, b) => (b.taskNumber || 0) - (a.taskNumber || 0))[0] || null),
            }),
          }),
        }),
      }),
      exists: jest.fn().mockImplementation((query: any) => Promise.resolve(existing.some(t => t.taskNumber === query.taskNumber) ? {} : null)),
    };
    const service = new AgentTasksService(genericModel as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    (service as any).genericModel = genericModel;
    return { assign: (dto: IAgentTask) => (service as any).assignTaskNumber(dto), genericModel };
  }

  const agentTask = (extra: Partial<IAgentTask> = {}): IAgentTask => ({
    orgId: 'org-1',
    name: 'tarea',
    assignedType: AssignedType.AGENT,
    agentCard: { id: 'card-1' } as any,
    ...extra,
  });

  it('starts a fresh sequence at 1', async () => {
    const { assign } = createService([]);
    const dto = agentTask();

    await assign(dto);

    expect(dto.taskNumber).toBe(1);
  });

  it('continues an existing sequence at max + 1', async () => {
    const { assign } = createService([{ taskNumber: 1 }, { taskNumber: 6 }, { taskNumber: 3 }]);
    const dto = agentTask();

    await assign(dto);

    expect(dto.taskNumber).toBe(7);
  });

  it('honours the number the markdown file proposes when it is free', async () => {
    const { assign } = createService([{ taskNumber: 1 }]);
    const dto = agentTask({ taskNumber: 22 });

    await assign(dto);

    expect(dto.taskNumber).toBe(22);
  });

  it('pushes a colliding proposal to the end instead of duplicating it', async () => {
    const { assign } = createService([{ taskNumber: 1 }, { taskNumber: 2 }]);
    const dto = agentTask({ taskNumber: 2 });

    await assign(dto);

    expect(dto.taskNumber).toBe(3);
  });

  it('leaves an unassigned task without a number, dropping any guess', async () => {
    const { assign, genericModel } = createService([{ taskNumber: 4 }]);
    const dto: IAgentTask = { orgId: 'org-1', name: 'sin dueño', taskNumber: 9 };

    await assign(dto);

    expect(dto.taskNumber).toBeUndefined();
    expect(genericModel.findOne).not.toHaveBeenCalled();
  });
});

describe('AgentTasksService.renumberOnReassignment', () => {
  function createService(existing: { taskNumber?: number }[] = []) {
    const genericModel = {
      findOne: jest.fn().mockReturnValue({
        sort: () => ({ select: () => ({ lean: () => ({ exec: () => Promise.resolve(existing.slice().sort((a, b) => (b.taskNumber || 0) - (a.taskNumber || 0))[0] || null) }) }) }),
      }),
      exists: jest.fn().mockResolvedValue(null),
    };
    const service = new AgentTasksService(genericModel as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    (service as any).genericModel = genericModel;
    return (dto: IAgentTask, previous: IAgentTask | null) => (service as any).renumberOnReassignment(dto, previous);
  }

  const owned = (cardId: string, taskNumber?: number): IAgentTask => ({
    orgId: 'org-1',
    name: 'tarea',
    assignedType: AssignedType.AGENT,
    agentCard: { id: cardId } as any,
    taskNumber,
  });

  it('keeps the number immutable while the owner does not change', async () => {
    const renumber = createService([{ taskNumber: 9 }]);
    const dto = owned('card-1', 99); // a stale/edited payload must not be able to rewrite it

    await renumber(dto, owned('card-1', 4));

    expect(dto.taskNumber).toBe(4);
  });

  it('mints a number in the new sequence when the task changes hands', async () => {
    const renumber = createService([{ taskNumber: 9 }]); // the NEW owner already has 9 tasks
    const dto = owned('card-2', 4);

    await renumber(dto, owned('card-1', 4));

    expect(dto.taskNumber).toBe(10);
  });

  it('drops the number when the task is left unassigned', async () => {
    const renumber = createService([]);
    const dto: IAgentTask = { orgId: 'org-1', name: 'tarea', taskNumber: 4 };

    await renumber(dto, owned('card-1', 4));

    expect(dto.taskNumber).toBeUndefined();
  });
});
