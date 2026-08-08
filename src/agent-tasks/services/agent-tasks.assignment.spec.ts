import { AgentTasksService } from './agent-tasks.service';
import { IAgentTask } from '../models/classes';

/**
 * The agentic profile is the canonical owner of a task. These cases pin the two directions the UI
 * offers (pick a profile in the task form / create a task from a profile) plus the legacy payload
 * that only carries a card, so all three converge on the same persisted shape.
 */
describe('AgentTasksService.resolveAgentAssignment', () => {
  const profile = {
    id: 'profile-1',
    _id: 'profile-1',
    name: 'Kaholik',
    title: 'Agente de Tareas',
    agentCard: { id: 'card-1', name: 'Kaholik Card', imageUrl: 'https://cdn/kaholik.png' },
  };

  function createService(profileFound: any = profile) {
    const agenticProfileModel = {
      findOne: jest.fn().mockReturnValue({ exec: () => Promise.resolve(profileFound) }),
    };
    const conversationAiService = {
      getConversationById: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({ id, name: 'Kaholik Card', description: 'card desc', assets: { image: { url: 'https://cdn/kaholik.png' } } })
      ),
    };
    const service = new AgentTasksService(
      {} as any,
      agenticProfileModel as any,
      {} as any,
      conversationAiService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    const resolve = (dto: IAgentTask) => (service as any).resolveAgentAssignment(dto);
    return { resolve, agenticProfileModel, conversationAiService };
  }

  it('fills the flat mirror and the derived card from the selected profile', async () => {
    const { resolve } = createService();
    const dto: IAgentTask = { name: 'Nueva tarea', agenticProfile: { id: 'profile-1' } };

    await resolve(dto);

    expect(dto.agenticProfileId).toBe('profile-1');
    expect(dto.agenticProfile).toEqual({
      id: 'profile-1',
      name: 'Kaholik',
      title: 'Agente de Tareas',
      agentCardId: 'card-1',
      imageUrl: 'https://cdn/kaholik.png',
    });
    expect(dto.agentCard).toEqual({
      id: 'card-1',
      name: 'Kaholik Card',
      description: 'card desc',
      assets: { image: { url: 'https://cdn/kaholik.png' } },
    });
  });

  it('replaces a stale card when the task is reassigned to another profile', async () => {
    const { resolve } = createService();
    const dto: IAgentTask = { name: 'Tarea', agenticProfileId: 'profile-1', agentCard: { id: 'old-card' } as any };

    await resolve(dto);

    expect(dto.agentCard?.id).toBe('card-1');
  });

  it('resolves the profile from a card-only payload (legacy records, organigram quick-add)', async () => {
    const { resolve, agenticProfileModel } = createService();
    const dto: IAgentTask = { name: 'Tarea', agentCard: { id: 'card-1' } as any };

    await resolve(dto);

    expect(agenticProfileModel.findOne).toHaveBeenCalledWith({ 'agentCard.id': 'card-1' });
    expect(dto.agenticProfileId).toBe('profile-1');
    expect(dto.agenticProfile?.agentCardId).toBe('card-1');
  });

  it('leaves a human task untouched', async () => {
    const { resolve, agenticProfileModel, conversationAiService } = createService();
    const dto: IAgentTask = { name: 'Tarea humana', assignedTo: { userId: 'uid', email: 'a@b.c', name: 'Kenya' } as any };

    await resolve(dto);

    expect(agenticProfileModel.findOne).not.toHaveBeenCalled();
    expect(conversationAiService.getConversationById).not.toHaveBeenCalled();
    expect(dto.agenticProfile).toBeUndefined();
    expect(dto.agentCard).toBeUndefined();
  });
});
