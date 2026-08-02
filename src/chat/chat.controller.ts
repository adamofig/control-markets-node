import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppToken } from '@dataclouder/nest-auth';
import { AppGuard } from '@dataclouder/nest-core';
import { FastifyReply } from 'fastify';
import { OrgId } from '../common/org-id.decorator';
import { DecodedToken } from '../common/token.decorator';
import { InboxIdentityService } from '../inbox/services/inbox-identity.service';
import { ProjectAuthGuard } from '../user/project-auth.guard';
import { UiContextSanitizerService } from './context/ui-context-sanitizer.service';
import { ChatService } from './chat.service';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly sanitizer: UiContextSanitizerService,
    private readonly identities: InboxIdentityService,
  ) {}

  @Post('stream')
  @ApiOperation({ summary: 'Stream a context-aware chat response' })
  async streamChat(
    @Body() body: unknown,
    @Res() res: FastifyReply,
    @DecodedToken() token: AppToken,
    @OrgId() requestedOrgId?: string,
  ) {
    const request = this.sanitizer.parseRequest(body);
    const actor = await this.identities.resolveActor(token, requestedOrgId);
    const execution = await this.chatService.streamChat(request, token, actor.orgId);

    res.raw.setHeader('Content-Type', 'text/event-stream');
    res.raw.setHeader('Cache-Control', 'no-cache');
    res.raw.setHeader('Connection', 'keep-alive');
    res.raw.setHeader('Access-Control-Allow-Origin', '*');
    res.raw.write(`data: ${JSON.stringify({ type: 'context', context: execution.contextAck })}\n\n`);

    try {
      for await (const chunk of execution.textStream) {
        res.raw.write(`data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`);
      }
      res.raw.write('data: [DONE]\n\n');
    } catch {
      res.raw.write(`data: ${JSON.stringify({ error: 'Stream error occurred' })}\n\n`);
    } finally {
      res.raw.end();
    }
  }
}
