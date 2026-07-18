import { AgenticContextLevel } from '../agentic-profile/models/agentic-profile.models';

export interface InjectedContextSnapshot {
  level: AgenticContextLevel;
  content: string;
  characters: number;
  estimatedTokens: number;
  capturedAt: string;
}

export function createInjectedContextSnapshot(content: string): InjectedContextSnapshot {
  const level = content.match(/^contextLevel:\s*["']?(basic|medium|full)/m)?.[1] as AgenticContextLevel | undefined;
  return {
    level: level ?? 'basic',
    content,
    characters: content.length,
    estimatedTokens: Math.ceil(content.length / 4),
    capturedAt: new Date().toISOString(),
  };
}
