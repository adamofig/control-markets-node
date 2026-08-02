import { AssignedType } from '../../agent-tasks/models/classes';
import { InboxTaskAutomationService } from './inbox-task-automation.service';

describe('InboxTaskAutomationService', () => {
  it('opens a task thread and publishes an idempotent automatic message for a human assignee', async () => {
    const tasks = {
      findOne: jest.fn().mockResolvedValue({
        id: 'task-1',
        orgId: 'org-1',
        name: 'Preparar campaña',
        assignedType: AssignedType.USER,
        assignedTo: { userId: 'user-2', name: 'Grace', email: 'grace@example.com' },
      }),
    };
    const assignedUser = { participantId: 'user:user-2', type: 'user', refId: 'user-2', displayName: 'Grace' };
    const identities = { findOrganizationUser: jest.fn().mockResolvedValue(assignedUser) };
    const conversations = {
      getOrCreateTask: jest.fn().mockResolvedValue({ conversation: { id: 'conversation-1' }, membership: {} }),
    };
    const taskAgent = {
      orgId: 'org-1',
      agenticProfileId: '6a6e5c9a6bf9cbb98d96cda9',
      agentCardId: 'card-zazu',
      participant: { participantId: 'agent:card-zazu', type: 'agent_card', refId: 'card-zazu', displayName: 'Zazu' },
      agentContext: { agentMode: 'agentic', agentCardId: 'card-zazu', agenticProfileId: '6a6e5c9a6bf9cbb98d96cda9' },
    };
    const agentIdentities = { resolveInternal: jest.fn().mockResolvedValue(taskAgent) };
    const agentMessages = { sendInternalToConversation: jest.fn().mockResolvedValue({ message: { id: 'message-1' }, agentResponseExpected: false }) };
    const service = new InboxTaskAutomationService(tasks as any, identities as any, conversations as any, agentIdentities as any, agentMessages as any);

    await service.onTaskChanged({ id: 'task-1' });

    expect(agentIdentities.resolveInternal).toHaveBeenCalledWith('org-1', '6a6e5c9a6bf9cbb98d96cda9');
    expect(conversations.getOrCreateTask).toHaveBeenCalledWith('org-1', taskAgent.participant, 'task-1', 'Tarea · Preparar campaña', [assignedUser]);
    expect(agentMessages.sendInternalToConversation).toHaveBeenCalledWith(
      taskAgent,
      'conversation-1',
      expect.objectContaining({
        clientMessageId: 'auto:task-assigned:task-1:user-2',
        parts: [expect.objectContaining({ type: 'text', text: expect.stringContaining('Preparar campaña') })],
      }),
      { type: 'task_automation', executionId: 'task:task-1' }
    );
  });

  it('does not create Inbox threads for non-human assignments', async () => {
    const tasks = {
      findOne: jest.fn().mockResolvedValue({ id: 'task-1', orgId: 'org-1', assignedType: AssignedType.AGENT, assignedTo: { id: 'agent-1' } }),
    };
    const conversations = { getOrCreateTask: jest.fn() };
    const service = new InboxTaskAutomationService(tasks as any, {} as any, conversations as any, {} as any, {} as any);

    await service.onTaskChanged({ id: 'task-1' });

    expect(conversations.getOrCreateTask).not.toHaveBeenCalled();
  });
});
