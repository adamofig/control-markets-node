// FilesystemToolsService pulls in the ESM-only `ai` package, which Jest cannot parse. The bridge
// only needs its `enabled` flag and `workspaceRoots`, both stubbed by the fake below.
jest.mock('./filesystem-tools.service', () => ({ FilesystemToolsService: class {} }));

import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { AcpBridgeService } from './acp-bridge.service';
import { LocalAgentStreamEvent } from './local-agent-chat.service';

/**
 * End-to-end check of the `agy` engine through the real bridge: it spawns the vendored adapter,
 * which spawns the Antigravity CLI, and asserts on the exact SSE event union the controller
 * streams to the browser. Green here means the UI can talk to `agy` through the local script.
 *
 * Hits the network and needs a logged-in `agy` on the host, so it is opt-in:
 *   RUN_AGY_E2E=1 npx jest src/local-agent/acp-bridge.agy.spec.ts
 */
const describeE2E = process.env.RUN_AGY_E2E === '1' ? describe : describe.skip;

describeE2E('AcpBridgeService · agy engine (E2E, requires local agy)', () => {
  let service: AcpBridgeService;
  let workspaceRoot: string;
  let secondaryRoot: string;

  beforeAll(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'agy-bridge-root-'));
    secondaryRoot = mkdtempSync(join(tmpdir(), 'agy-bridge-extra-'));
    writeFileSync(join(workspaceRoot, 'marcador.txt'), 'el codigo secreto es ZANZIBAR-77\n', 'utf-8');
    service = new AcpBridgeService({ enabled: true, workspaceRoots: [workspaceRoot, secondaryRoot] } as any);
  });

  afterAll(() => {
    service.onModuleDestroy();
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(secondaryRoot, { recursive: true, force: true });
  });

  const collect = async (message: string, sessionId?: string, runtime: Record<string, unknown> = {}): Promise<LocalAgentStreamEvent[]> => {
    const events: LocalAgentStreamEvent[] = [];
    for await (const event of service.stream(message, sessionId, undefined, 'agy', { cwd: workspaceRoot, ...runtime })) {
      events.push(event);
    }
    return events;
  };

  it('streams a turn with text deltas and token usage', async () => {
    const events = await collect('Responde únicamente con la palabra PONG.');
    const errors = events.filter(e => e.type === 'error');
    expect(errors).toEqual([]);

    const session = events.find(e => e.type === 'session') as any;
    expect(session?.sessionId).toBeTruthy();
    // The UI renders these, so they must be the adapter's negotiated values, not echoes of the
    // request (which asked for neither): agy defaults to gemini-3.7-flash at high effort.
    expect(session?.model).toBe('gemini-3.7-flash');
    expect(session?.reasoningEffort).toBe('high');

    const text = events
      .filter((e): e is Extract<LocalAgentStreamEvent, { type: 'text-delta' }> => e.type === 'text-delta')
      .map(e => e.text)
      .join('');
    expect(text).toMatch(/pong/i);

    // The whole point of the vendored adapter: the finish event carries real token counts.
    const finish = events.find(e => e.type === 'finish') as any;
    expect(finish).toBeDefined();
    expect(finish.usage?.inputTokens).toBeGreaterThan(0);
    expect(finish.usage?.outputTokens).toBeGreaterThan(0);
    expect(finish.usage?.provider).toBe('agy');
    expect(finish.usage?.source).toBe('acp');
    // agy reports no USD anywhere, so a cost here would mean we invented one.
    expect(finish.usage?.estimatedCostUsd).toBeUndefined();
    // The adapter default must be recorded even though the caller picked no model.
    expect(finish.usage?.model).toBeTruthy();
  }, 240_000);

  it('reports back the model and effort the adapter actually negotiated', async () => {
    const events = await collect('Responde solo con la palabra OK.', undefined, { model: 'gemini-3.5-flash', reasoningEffort: 'low' });
    expect(events.filter(e => e.type === 'error')).toEqual([]);

    // What the UI paints. It must be the adapter's post-negotiation value, so that asking for
    // `high` and silently getting the default is impossible to miss.
    const session = events.find(e => e.type === 'session') as any;
    expect(session.model).toBe('gemini-3.5-flash');
    expect(session.reasoningEffort).toBe('low');
    expect((events.find(e => e.type === 'finish') as any)?.usage?.model).toBe('gemini-3.5-flash');
  }, 240_000);

  it('keeps the conversation, mounts every workspace root and runs tools', async () => {
    const first = await collect('Recuerda este número: 4271. Responde solo "ok".');
    const sessionEvent = first.find(e => e.type === 'session') as any;
    expect(sessionEvent?.sessionId).toBeTruthy();
    expect(sessionEvent?.cliSessionId).toBeTruthy();

    // The adapter persists what it was told to mount, so its state file is the ground truth for
    // `cwd` and the extra roots the bridge forwarded as ACP `additionalDirectories`.
    const state = JSON.parse(readFileSync(join(homedir(), '.agy-acp-state.json'), 'utf-8'));
    const adapterSession = state.sessions[sessionEvent.cliSessionId];
    expect(adapterSession?.cwd).toBe(workspaceRoot);
    expect(adapterSession?.additionalDirectories).toContain(secondaryRoot);
    expect(adapterSession?.conversationId).toBeTruthy(); // continuity handle for the next turn

    const second = await collect(
      `Lee el archivo ${join(workspaceRoot, 'marcador.txt')} y responde con el código secreto que contiene y el número que te pedí recordar.`,
      sessionEvent.sessionId
    );
    expect(second.filter(e => e.type === 'error')).toEqual([]);

    const text = second
      .filter((e): e is Extract<LocalAgentStreamEvent, { type: 'text-delta' }> => e.type === 'text-delta')
      .map(e => e.text)
      .join('');
    expect(text).toContain('ZANZIBAR-77'); // the tool really read the file
    expect(text).toContain('4271'); // and the CLI-side conversation survived across turns

    expect(second.some(e => e.type === 'tool-call')).toBe(true);
    expect(second.some(e => e.type === 'tool-result')).toBe(true);

    // CM-P7: the adapter recovers the reasoning from the CLI's on-disk transcript and the bridge
    // must surface it as `reasoning-delta` — that event is what ends up in
    // `agentic_conversations.messages[].reasoning`, i.e. why the agent took the path it took.
    const reasoning = second
      .filter((e): e is Extract<LocalAgentStreamEvent, { type: 'reasoning-delta' }> => e.type === 'reasoning-delta')
      .map(e => e.text)
      .join('');
    // A turn with tools always carries at least the per-call rationale; the `thinking` block itself
    // is sporadic, so asserting on it would make this test flaky against the model's own whim.
    expect(reasoning).toMatch(/🔧 Paso \d+ · `\w+`/);

    // The first turn's trace must not leak into the second: the transcript file is shared by the
    // whole conversation, so a tail that restarted at byte 0 would replay it on every turn.
    const firstReasoning = first
      .filter((e): e is Extract<LocalAgentStreamEvent, { type: 'reasoning-delta' }> => e.type === 'reasoning-delta')
      .map(e => e.text);
    expect(firstReasoning.filter(block => reasoning.includes(block))).toEqual([]);
  }, 300_000);
});
