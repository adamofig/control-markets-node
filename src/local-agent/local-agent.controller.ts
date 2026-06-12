import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppToken, AuthGuard } from '@dataclouder/nest-auth';
import { AppGuard } from '@dataclouder/nest-core';
import { FastifyReply } from 'fastify';
import { DecodedToken } from '../common/token.decorator';
import { LocalAgentChatService, LocalAgentMessage, LocalAgentStreamEvent } from './local-agent-chat.service';
import { AcpBridgeService } from './acp-bridge.service';

class LocalAgentChatRequestDto {
  messages: LocalAgentMessage[];
  agenticProfileId?: string;
  orgId?: string;
}

class AcpStreamRequestDto {
  message: string;
  sessionId?: string;
  agenticProfileId?: string;
  orgId?: string;
}

class AcpPermissionRequestDto {
  sessionId: string;
  requestId: string;
  optionId: string;
}

@ApiTags('Local Agent')
@ApiBearerAuth()
@UseGuards(AppGuard, AuthGuard)
@Controller('api/local-agent')
export class LocalAgentController {
  constructor(
    private readonly localAgentChatService: LocalAgentChatService,
    private readonly acpBridge: AcpBridgeService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Report whether local agent mode is enabled and which workspace roots are mounted' })
  async getStatus() {
    const acp = await this.acpBridge.getAcpStatus();
    return { ...this.localAgentChatService.getStatus(), ...acp };
  }

  @Post('stream')
  @ApiOperation({ summary: 'Stream a local agent chat with profile context and filesystem tools (structured SSE events)' })
  async streamChat(@Body() body: LocalAgentChatRequestDto, @Res() res: FastifyReply, @DecodedToken() token: AppToken) {
    res.raw.setHeader('Content-Type', 'text/event-stream');
    res.raw.setHeader('Cache-Control', 'no-cache');
    res.raw.setHeader('Connection', 'keep-alive');
    res.raw.setHeader('Access-Control-Allow-Origin', '*');

    const events = this.localAgentChatService.streamChat(body.messages, token, body.agenticProfileId, body.orgId);
    await this.pipeSse(events, res);
  }

  @Post('acp/stream')
  @ApiOperation({ summary: 'Stream a chat turn through the local Gemini CLI via the Agent Client Protocol (structured SSE events)' })
  async streamAcp(@Body() body: AcpStreamRequestDto, @Res() res: FastifyReply, @DecodedToken() token: AppToken) {
    res.raw.setHeader('Content-Type', 'text/event-stream');
    res.raw.setHeader('Cache-Control', 'no-cache');
    res.raw.setHeader('Connection', 'keep-alive');
    res.raw.setHeader('Access-Control-Allow-Origin', '*');

    let profileContext: string | undefined;
    if (body.agenticProfileId && !body.sessionId) {
      profileContext = await this.localAgentChatService
        .getProfileContext(body.agenticProfileId, body.orgId ?? token['orgId'])
        .catch(() => undefined);
    }

    const events = this.acpBridge.stream(body.message, body.sessionId, profileContext);
    await this.pipeSse(events, res);
  }

  @Post('acp/permission')
  @ApiOperation({ summary: 'Answer a pending ACP tool permission request' })
  respondAcpPermission(@Body() body: AcpPermissionRequestDto) {
    return this.acpBridge.respondPermission(body.sessionId, body.requestId, body.optionId);
  }

  @Post('acp/cancel')
  @ApiOperation({ summary: 'Cancel the in-flight ACP turn for a session' })
  cancelAcp(@Body() body: { sessionId: string }) {
    return this.acpBridge.cancel(body.sessionId);
  }

  private async pipeSse(events: AsyncGenerator<LocalAgentStreamEvent>, res: FastifyReply) {
    try {
      for await (const event of events) {
        res.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      res.raw.write('data: [DONE]\n\n');
    } catch (error) {
      console.error('Local agent stream error:', error);
      res.raw.write(`data: ${JSON.stringify({ type: 'error', error: error?.message ?? 'Stream error occurred' })}\n\n`);
    } finally {
      res.raw.end();
    }
  }
}
