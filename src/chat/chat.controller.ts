import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppToken, AuthGuard } from '@dataclouder/nest-auth';
import { AppGuard } from '@dataclouder/nest-core';
import { FastifyReply } from 'fastify';
import { DecodedToken } from '../common/token.decorator';
import { ChatService } from './chat.service';

class ChatMessageDto {
  role: 'user' | 'assistant';
  content: string;
}

class ChatRequestDto {
  messages: ChatMessageDto[];
}

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(AppGuard, AuthGuard)
@Controller('api/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('stream')
  @ApiOperation({ summary: 'Stream a chat response from Gemini Flash' })
  async streamChat(@Body() body: ChatRequestDto, @Res() res: FastifyReply, @DecodedToken() token: AppToken) {
    res.raw.setHeader('Content-Type', 'text/event-stream');
    res.raw.setHeader('Cache-Control', 'no-cache');
    res.raw.setHeader('Connection', 'keep-alive');
    res.raw.setHeader('Access-Control-Allow-Origin', '*');

    try {
      const textStream = await this.chatService.streamChat(body.messages, token);

      for await (const chunk of textStream) {
        res.raw.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }

      res.raw.write('data: [DONE]\n\n');
    } catch (error) {
      res.raw.write(`data: ${JSON.stringify({ error: 'Stream error occurred' })}\n\n`);
    } finally {
      res.raw.end();
    }
  }
}
