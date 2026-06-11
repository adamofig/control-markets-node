import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppToken, AuthGuard } from '@dataclouder/nest-auth';
import { AppGuard } from '@dataclouder/nest-core';
import { FastifyReply } from 'fastify';
import { DecodedToken } from '../common/token.decorator';
import { LocalAgentChatService, LocalAgentMessage } from './local-agent-chat.service';

class LocalAgentChatRequestDto {
  messages: LocalAgentMessage[];
  agenticProfileId?: string;
  orgId?: string;
}

@ApiTags('Local Agent')
@ApiBearerAuth()
@UseGuards(AppGuard, AuthGuard)
@Controller('api/local-agent')
export class LocalAgentController {
  constructor(private readonly localAgentChatService: LocalAgentChatService) {}

  @Get('status')
  @ApiOperation({ summary: 'Report whether local agent mode is enabled and which workspace roots are mounted' })
  getStatus() {
    return this.localAgentChatService.getStatus();
  }

  @Post('stream')
  @ApiOperation({ summary: 'Stream a local agent chat with profile context and filesystem tools (structured SSE events)' })
  async streamChat(@Body() body: LocalAgentChatRequestDto, @Res() res: FastifyReply, @DecodedToken() token: AppToken) {
    res.raw.setHeader('Content-Type', 'text/event-stream');
    res.raw.setHeader('Cache-Control', 'no-cache');
    res.raw.setHeader('Connection', 'keep-alive');
    res.raw.setHeader('Access-Control-Allow-Origin', '*');

    try {
      const events = this.localAgentChatService.streamChat(body.messages, token, body.agenticProfileId, body.orgId);
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
