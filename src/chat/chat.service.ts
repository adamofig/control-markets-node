import { Injectable } from '@nestjs/common';
import { streamText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { AppToken } from '@dataclouder/nest-auth';
import { AppUserService } from '../user/user.service';

@Injectable()
export class ChatService {
  private google = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  constructor(private readonly userService: AppUserService) {}

  async streamChat(
    messages: { role: 'user' | 'assistant'; content: string }[],
    token: AppToken,
  ): Promise<AsyncIterable<string>> {
    const system = this.buildSystemPrompt(token);

    const result = streamText({
      model: this.google('gemini-3.1-flash-lite-preview'),
      system,
      messages,
    });

    return result.textStream;
  }

  private buildSystemPrompt(token: AppToken): string {
    return `You are a helpful assistant inside the Polilan language learning app.

Current user context:
- User ID: ${token.userId}
- Email: ${token.email}
- Display name: ${token.name ?? 'unknown'}
- Plan: ${token.plan?.type ?? 'basic'}

You have access to tools to fetch more details from the database when the user asks about their profile, stats, settings, or saved words. Use tools proactively when needed to give accurate, personalized answers.`;
  }
}
