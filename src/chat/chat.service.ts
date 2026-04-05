import { Injectable } from '@nestjs/common';
import { streamText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { AppToken } from '@dataclouder/nest-auth';
import { AppUserService } from '../user/user.service';
import { CreativeFlowboardService } from '../creative-flowboard/services/creative-flowboard.service';

@Injectable()
export class ChatService {
  private google = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  constructor(
    private readonly userService: AppUserService,
    private readonly flowboardService: CreativeFlowboardService,
  ) {}

  async streamChat(
    messages: { role: 'user' | 'assistant'; content: string }[],
    token: AppToken,
  ): Promise<AsyncIterable<string>> {
    const system = this.buildSystemPrompt(token);

    const result = streamText({
      model: this.google('gemini-3.1-flash-lite-preview'),
      system,
      messages,
      stopWhen: stepCountIs(5),
      tools: {
        moveNodes: tool({
          description:
            'Move one or more nodes on a flowboard canvas to new (x, y) positions. Use when the user asks to rearrange, move, or reposition nodes on a flow.',
          inputSchema: z.object({
            flowId: z.string().describe('The ID of the flowboard to update.'),
            positions: z
              .array(
                z.object({
                  nodeId: z.string().describe('The ID of the node to move.'),
                  x: z.number().describe('New X coordinate on the canvas.'),
                  y: z.number().describe('New Y coordinate on the canvas.'),
                }),
              )
              .describe('List of nodes and their new positions.'),
          }),
          execute: async ({ flowId, positions }) => {
            const result = await this.flowboardService.moveNodes(flowId, positions);
            return {
              success: true,
              flowId,
              updatedNodes: positions.map(p => p.nodeId),
              totalNodes: result.nodes.length,
            };
          },
        }),
      },
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
