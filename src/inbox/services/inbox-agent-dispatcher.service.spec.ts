// Both engine modules pull the ESM-only `ai` package through their imports. The dispatcher only
// needs them as DI tokens here, so they are stubbed the same way `acp-bridge.service.spec.ts` does.
jest.mock('../../local-agent/filesystem-tools.service', () => ({ FilesystemToolsService: class {} }));
jest.mock('../../local-agent/local-agent-chat.service', () => ({ LocalAgentChatService: class {} }));

import type { LocalAgentStreamEvent } from '../../local-agent/local-agent-chat.service';
import { InboxAgentDispatcherService } from './inbox-agent-dispatcher.service';

async function* streamOf(...events: LocalAgentStreamEvent[]): AsyncGenerator<LocalAgentStreamEvent> {
  for (const event of events) yield event;
}

describe('InboxAgentDispatcherService', () => {
  const agentIdentity = {
    orgId: 'org-1',
    agenticProfileId: 'profile-1',
    agentCardId: 'card-1',
    acpConfig: { defaultEngine: 'agy' as const, defaultModel: 'gemini-3.6-flash' },
    participant: { participantId: 'agent:card-1', type: 'agent_card' as const, refId: 'card-1', displayName: 'Zazu' },
    agentContext: { agentMode: 'agentic' as const, agentCardId: 'card-1', agenticProfileId: 'profile-1', engine: 'agy' as const },
  };

  function createService(overrides: { conversation?: Record<string, any> | null; acpAvailable?: boolean } = {}) {
    const conversation =
      overrides.conversation === undefined
        ? { id: 'conversation-1', type: 'agent', agentContext: { agentMode: 'conversational', agenticProfileId: 'profile-1', engine: 'agy' } }
        : overrides.conversation;

    const conversations = {
      findById: jest.fn().mockResolvedValue(conversation),
      recipientRefIds: jest.fn().mockResolvedValue(['user-1', 'card-1']),
      updateAgentSession: jest.fn().mockResolvedValue(undefined),
    };
    const messages = { recentTurns: jest.fn().mockResolvedValue([{ role: 'user', content: '¿Cómo vas?' }]) };
    const agentIdentities = { resolveInternal: jest.fn().mockResolvedValue(agentIdentity) };
    const agentMessages = { sendInternalToConversation: jest.fn().mockResolvedValue({ message: { id: 'reply-1' } }) };
    const acpBridge = {
      enabled: overrides.acpAvailable ?? false,
      getAcpStatus: jest.fn().mockResolvedValue({ engines: { agy: { available: overrides.acpAvailable ?? false, version: '1.0' } } }),
      stream: jest.fn(() => streamOf({ type: 'text-delta', text: 'Todo bien.' })),
      respondPermission: jest.fn(),
      cancel: jest.fn(),
    };
    const localAgentChat = {
      streamChat: jest.fn(() => streamOf({ type: 'text-delta', text: 'Todo bien.' })),
      getProfileContext: jest.fn().mockResolvedValue('# Zazu'),
    };
    const workspaces = { resolveRootForHost: jest.fn().mockReturnValue(null) };
    const events = { emit: jest.fn() };

    return {
      service: new InboxAgentDispatcherService(
        conversations as any,
        messages as any,
        agentIdentities as any,
        agentMessages as any,
        acpBridge as any,
        localAgentChat as any,
        workspaces as any,
        events as any
      ),
      conversations,
      messages,
      agentIdentities,
      agentMessages,
      acpBridge,
      localAgentChat,
      events,
    };
  }

  it('ignores conversations that are not agent threads', async () => {
    const { service, agentIdentities, agentMessages } = createService({ conversation: { id: 'conversation-1', type: 'direct' } });

    await service.dispatch('org-1', 'conversation-1', 'message-1', 'Adamo');

    expect(agentIdentities.resolveInternal).not.toHaveBeenCalled();
    expect(agentMessages.sendInternalToConversation).not.toHaveBeenCalled();
  });

  it('falls back to the built-in harness when no ACP engine is reachable on this host', async () => {
    const { service, acpBridge, localAgentChat, agentMessages } = createService({ acpAvailable: false });

    await service.dispatch('org-1', 'conversation-1', 'message-1', 'Adamo');

    expect(acpBridge.stream).not.toHaveBeenCalled();
    expect(localAgentChat.streamChat).toHaveBeenCalled();
    expect(agentMessages.sendInternalToConversation).toHaveBeenCalledWith(
      agentIdentity,
      'conversation-1',
      expect.objectContaining({
        clientMessageId: 'agent-reply:message-1',
        parts: [{ type: 'text', format: 'markdown', text: 'Todo bien.' }],
      }),
      expect.objectContaining({ type: 'local', engine: 'builtin' }),
      expect.objectContaining({ mode: 'conversational', status: 'completed', engine: 'builtin' })
    );
  });

  it('runs the thread engine over ACP and binds the session to the conversation', async () => {
    const { service, acpBridge, conversations, agentMessages } = createService({ acpAvailable: true });
    acpBridge.stream.mockReturnValue(
      streamOf(
        { type: 'session', sessionId: 'acp-1' },
        { type: 'tool-call', toolName: 'webSearch', input: { q: 'x' } },
        { type: 'tool-result', toolName: 'webSearch', output: 'ok' },
        { type: 'text-delta', text: 'Listo.' }
      )
    );

    await service.dispatch('org-1', 'conversation-1', 'message-1', 'Adamo');

    expect(acpBridge.stream).toHaveBeenCalledWith(
      expect.stringContaining('¿Cómo vas?'),
      undefined,
      '# Zazu',
      'agy',
      expect.objectContaining({ model: 'gemini-3.6-flash' })
    );
    expect(conversations.updateAgentSession).toHaveBeenCalledWith('org-1', 'conversation-1', 'acp-1');
    expect(agentMessages.sendInternalToConversation).toHaveBeenCalledWith(
      agentIdentity,
      'conversation-1',
      expect.objectContaining({ parts: [{ type: 'text', format: 'markdown', text: 'Listo.' }] }),
      expect.objectContaining({ engine: 'agy' }),
      expect.objectContaining({
        externalSessionId: 'acp-1',
        tools: [expect.objectContaining({ toolName: 'webSearch', status: 'completed' })],
      })
    );
  });

  it('auto-approves permission requests so a headless turn never hangs', async () => {
    const { service, acpBridge } = createService({ acpAvailable: true });
    acpBridge.stream.mockReturnValue(
      streamOf(
        { type: 'session', sessionId: 'acp-1' },
        {
          type: 'permission-request',
          requestId: 'req-1',
          toolName: 'writeFile',
          rationale: 'escribir',
          options: [
            { optionId: 'once', name: 'Permitir una vez', kind: 'allow_once' },
            { optionId: 'always', name: 'Permitir siempre', kind: 'allow_always' },
          ],
        },
        { type: 'text-delta', text: 'Hecho.' }
      )
    );

    await service.dispatch('org-1', 'conversation-1', 'message-1', 'Adamo');

    expect(acpBridge.respondPermission).toHaveBeenCalledWith('acp-1', 'req-1', 'always');
  });

  it('publishes the engine failure in the thread instead of leaving the user waiting', async () => {
    const { service, localAgentChat, agentMessages } = createService({ acpAvailable: false });
    localAgentChat.streamChat.mockReturnValue(streamOf({ type: 'error', error: 'quota exceeded' }));

    await service.dispatch('org-1', 'conversation-1', 'message-1', 'Adamo');

    expect(agentMessages.sendInternalToConversation).toHaveBeenCalledWith(
      agentIdentity,
      'conversation-1',
      expect.objectContaining({ parts: [expect.objectContaining({ text: expect.stringContaining('quota exceeded') })] }),
      expect.anything(),
      expect.objectContaining({ status: 'failed', error: 'quota exceeded' })
    );
  });

  it('brackets the turn with thinking and idle status events for the typing hint', async () => {
    const { service, events } = createService({ acpAvailable: false });

    await service.dispatch('org-1', 'conversation-1', 'message-1', 'Adamo');

    const states = events.emit.mock.calls.filter(call => call[0] === 'inbox.agent.status').map(call => call[3].state);
    expect(states).toEqual(['thinking', 'idle']);
  });

  it('keeps a single reply in flight per conversation', async () => {
    const { service, localAgentChat } = createService({ acpAvailable: false });
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => (release = resolve));
    localAgentChat.streamChat.mockImplementation(async function* () {
      await gate;
      yield { type: 'text-delta', text: 'Todo bien.' } as LocalAgentStreamEvent;
    });

    const first = service.dispatch('org-1', 'conversation-1', 'message-1', 'Adamo');
    await service.dispatch('org-1', 'conversation-1', 'message-2', 'Adamo');
    release();
    await first;

    expect(localAgentChat.streamChat).toHaveBeenCalledTimes(1);
  });
});
