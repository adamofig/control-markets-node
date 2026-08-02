import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AgentTasksService } from '../../agent-tasks/services/agent-tasks.service';
import { AssignedType, IAgentTask } from '../../agent-tasks/models/classes';
import { WIKI_TASK_CHANGED, WikiEntityChangedEvent } from '../../wiki-sync/wiki-sync.events';
import { InboxAgentIdentityService } from './inbox-agent-identity.service';
import { InboxAgentMessageService } from './inbox-agent-message.service';
import { InboxConversationService } from './inbox-conversation.service';
import { InboxIdentityService } from './inbox-identity.service';

/**
 * Bridges newly-created/updated human assignments into the new Inbox domain.
 * It deliberately does not read or write agentic_conversations: both systems
 * remain independent until an explicit migration is approved in the future.
 */
@Injectable()
export class InboxTaskAutomationService {
  private readonly logger = new Logger(InboxTaskAutomationService.name);
  private readonly taskAgenticProfileId = process.env.INBOX_TASK_AGENTIC_PROFILE_ID?.trim() || '6a6e5c9a6bf9cbb98d96cda9';

  constructor(
    private readonly tasks: AgentTasksService,
    private readonly identities: InboxIdentityService,
    private readonly conversations: InboxConversationService,
    private readonly agentIdentities: InboxAgentIdentityService,
    private readonly agentMessages: InboxAgentMessageService
  ) {}

  @OnEvent(WIKI_TASK_CHANGED, { async: true })
  async onTaskChanged(event: WikiEntityChangedEvent): Promise<void> {
    try {
      const task = (await this.tasks.findOne(event.id)) as unknown as IAgentTask;
      if (!task?.orgId || task.assignedType !== AssignedType.USER || !(task.assignedTo as any)?.userId) return;

      const assignedUser = await this.identities.findOrganizationUser(task.orgId, (task.assignedTo as any).userId);
      const taskId = task.id || task._id?.toString() || event.id;
      const taskAgent = await this.agentIdentities.resolveInternal(task.orgId, this.taskAgenticProfileId);
      const thread = await this.conversations.getOrCreateTask(task.orgId, taskAgent.participant, taskId, `Tarea · ${task.name || 'Sin título'}`, [assignedUser]);

      await this.agentMessages.sendInternalToConversation(
        taskAgent,
        thread.conversation.id,
        {
          clientMessageId: `auto:task-assigned:${taskId}:${assignedUser.refId}`.slice(0, 128),
          parts: [
            {
              type: 'text',
              format: 'plain',
              text: `Te asignaron la tarea “${task.name || 'Sin título'}”. ¿Puedes confirmar que la recibiste y compartir tu estimado?`,
            },
          ],
        },
        { type: 'task_automation', executionId: `task:${taskId}` }
      );
    } catch (error) {
      this.logger.warn(`Could not publish automatic Inbox task message for ${event?.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
