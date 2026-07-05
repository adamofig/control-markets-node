import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { MessagingOutboundService } from '../messaging/services/messaging-outbound.service';
import { ChannelType } from '../messaging/models/messaging.models';

@Injectable()
export class McpMessagingTools {
  constructor(private readonly outboundService: MessagingOutboundService) {}

  @Tool({
    name: 'messaging_notifyUser',
    description:
      'Send a direct message to a platform user/employee through their linked messaging channel (Telegram for now). Use it to remind about tasks, report progress, or alert about events. The user must have previously linked their channel; otherwise it returns delivered: false.',
    parameters: z.object({
      userId: z.string().describe('Control Markets userId of the recipient.'),
      orgId: z.string().describe('Organization ID the user belongs to.'),
      message: z.string().describe('Message text (markdown supported, chunked automatically).'),
      channel: z.enum(['telegram', 'whatsapp', 'discord']).optional().describe('Preferred channel; defaults to any verified one.'),
      sourceRef: z.string().optional().describe('Optional reference for auditing (taskId, heartbeat runId, etc.).'),
    }),
  })
  async notifyUser({ userId, orgId, message, channel, sourceRef }) {
    const result = await this.outboundService.notifyUser(userId, orgId, message, {
      channel: channel as ChannelType | undefined,
      source: 'mcp',
      sourceRef,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
}
