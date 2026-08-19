import { AgenticContextLevel, AgenticRuntimeProfile } from '../agentic-profile/models/agentic-profile.models';

export interface InjectedContextSnapshot {
  level: AgenticContextLevel;
  content: string;
  characters: number;
  estimatedTokens: number;
  capturedAt: string;
  /**
   * The reader this context was written for. Reported so "why does the agent not see my skill?"
   * can be answered from the snapshot itself — engine, registered tools and workspace roots — and
   * so an E2E run can assert what the container really got.
   */
  runtime?: AgenticRuntimeProfile;
}

export function createInjectedContextSnapshot(content: string, runtime?: AgenticRuntimeProfile): InjectedContextSnapshot {
  const level = content.match(/^contextLevel:\s*["']?(basic|medium|full)/m)?.[1] as AgenticContextLevel | undefined;
  return {
    level: level ?? 'basic',
    content,
    characters: content.length,
    estimatedTokens: Math.ceil(content.length / 4),
    capturedAt: new Date().toISOString(),
    runtime,
  };
}
