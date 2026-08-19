import { Injectable } from '@nestjs/common';
import { Tool, ToolScopes } from '@rekog/mcp-nest';
import { z } from 'zod';
import { MessagingOutboundService } from '../messaging/services/messaging-outbound.service';
import { ChannelType } from '../messaging/models/messaging.models';
import { requireMcpContext, resolveOrgArgument } from './mcp-scope.util';
import { MCP_SCOPES } from './mcp-scopes';

@Injectable()
export class McpMessagingTools {
  constructor(private readonly outboundService: MessagingOutboundService) {}

  @ToolScopes([MCP_SCOPES.messaging])
  @Tool({
    name: 'messaging_notifyUser',
    description:
      'Send a direct message to a platform user/employee through their linked messaging channel (Telegram for now). Use it to remind about tasks, report progress, or alert about events. The user must have previously linked their channel; otherwise it returns delivered: false.',
    parameters: z.object({
      userId: z.string().describe('Control Markets userId of the recipient.'),
      orgId: z.string().optional().describe('Organization the recipient belongs to. Defaults to yours; naming another one requires platform access.'),
      message: z.string().describe('Message text (markdown supported, chunked automatically).'),
      channel: z.enum(['telegram', 'whatsapp', 'discord']).optional().describe('Preferred channel; defaults to any verified one.'),
      sourceRef: z.string().optional().describe('Optional reference for auditing (taskId, heartbeat runId, etc.).'),
    }),
  })
  async notifyUser({ userId, orgId, message, channel, sourceRef }, _context: unknown, request: any) {
    // Sending a message is the one tool here that reaches a human being, so the organization it acts
    // on is the caller's unless they hold platform access — otherwise any token could message any
    // user of any tenant, with our name on the delivery.
    const resolved = resolveOrgArgument(orgId, requireMcpContext(request), 'messaging_notifyUser');
    const result = await this.outboundService.notifyUser(userId, resolved, message, {
      channel: channel as ChannelType | undefined,
      source: 'mcp',
      sourceRef,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
}
