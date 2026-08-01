import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AgentTasksService } from '../../agent-tasks/services/agent-tasks.service';
import { AssignedType, IAgentTask } from '../../agent-tasks/models/classes';
import { WIKI_TASK_CHANGED, WikiEntityChangedEvent } from '../../wiki-sync/wiki-sync.events';
import { IInboxParticipantSnapshot } from '../models/inbox.models';
import { InboxConversationService } from './inbox-conversation.service';
import { InboxIdentityService } from './inbox-identity.service';
import { InboxMessageService } from './inbox-message.service';

/**
 * Bridges newly-created/updated human assignments into the new Inbox domain.
 * It deliberately does not read or write agentic_conversations: both systems
 * remain independent until an explicit migration is approved in the future.
 */
@Injectable()
export class InboxTaskAutomationService {
  private readonly logger = new Logger(InboxTaskAutomationService.name);
  private readonly systemParticipant: IInboxParticipantSnapshot = {
    participantId: 'system:zazu',
    type: 'system',
    refId: 'zazu',
    displayName: 'Zazu',
  };

  constructor(
    private readonly tasks: AgentTasksService,
    private readonly identities: InboxIdentityService,
    private readonly conversations: InboxConversationService,
    private readonly messages: InboxMessageService
  ) {}

  @OnEvent(WIKI_TASK_CHANGED, { async: true })
  async onTaskChanged(event: WikiEntityChangedEvent): Promise<void> {
    try {
      const task = (await this.tasks.findOne(event.id)) as unknown as IAgentTask;
      if (!task?.orgId || task.assignedType !== AssignedType.USER || !(task.assignedTo as any)?.userId) return;

      const assignedUser = await this.identities.findOrganizationUser(task.orgId, (task.assignedTo as any).userId);
      const taskId = task.id || task._id?.toString() || event.id;
      const thread = await this.conversations.getOrCreateTask(task.orgId, this.systemParticipant, taskId, `Tarea · ${task.name || 'Sin título'}`, [assignedUser]);

      await this.messages.send(task.orgId, thread.conversation.id, this.systemParticipant.refId, {
        clientMessageId: `auto:task-assigned:${taskId}:${assignedUser.refId}`.slice(0, 128),
        parts: [
          {
            type: 'text',
            format: 'plain',
            text: `Te asignaron la tarea “${task.name || 'Sin título'}”. ¿Puedes confirmar que la recibiste y compartir tu estimado?`,
          },
        ],
      });
    } catch (error) {
      this.logger.warn(`Could not publish automatic Inbox task message for ${event?.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
