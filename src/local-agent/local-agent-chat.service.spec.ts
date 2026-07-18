import { createInjectedContextSnapshot } from './context-snapshot.util';

describe('LocalAgentChatService context snapshots', () => {
  it('captures the exact injected markdown and its context level', () => {
    const content = `---\ncontextLevel: "medium"\n---\n\n# Agent context`;

    const snapshot = createInjectedContextSnapshot(content);

    expect(snapshot.level).toBe('medium');
    expect(snapshot.content).toBe(content);
    expect(snapshot.characters).toBe(content.length);
    expect(snapshot.estimatedTokens).toBe(Math.ceil(content.length / 4));
    expect(Number.isNaN(Date.parse(snapshot.capturedAt))).toBe(false);
  });
});
