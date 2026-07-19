jest.mock('./filesystem-tools.service', () => ({ FilesystemToolsService: class {} }));

import { AcpBridgeService } from './acp-bridge.service';

describe('AcpBridgeService Claude ACP integration', () => {
  let service: AcpBridgeService;

  beforeEach(() => {
    service = new AcpBridgeService({ enabled: true } as any);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('captures exact USD cost from a user-turn usage update', () => {
    const session = { turnCostUsd: undefined } as any;

    const event = (service as any).mapUpdate(session, {
      sessionUpdate: 'usage_update',
      used: 123,
      size: 200_000,
      cost: { amount: 0.0123, currency: 'USD' },
    });

    expect(event).toBeNull();
    expect(session.turnCostUsd).toBe(0.0123);
  });

  it('does not attribute autonomous Claude usage to the active user turn', () => {
    const session = { turnCostUsd: 0.01 } as any;

    (service as any).mapUpdate(session, {
      sessionUpdate: 'usage_update',
      cost: { amount: 0.5, currency: 'USD' },
      _meta: { '_claude/origin': { kind: 'subagent' } },
    });

    expect(session.turnCostUsd).toBe(0.01);
  });

  it('selects an advertised Claude model through the standard config option', async () => {
    const setSessionConfigOption = jest.fn().mockResolvedValue({ configOptions: [] });
    const session = {
      id: 'bridge-session',
      acpSessionId: 'claude-session',
      connection: { setSessionConfigOption },
    } as any;
    const configOptions = [
      {
        id: 'model',
        currentValue: 'default',
        options: [
          { value: 'sonnet', name: 'Claude Sonnet' },
          { name: 'Other models', options: [{ value: 'opus', name: 'Claude Opus' }] },
        ],
      },
    ];

    await (service as any).applySessionModel(session, configOptions, 'opus');

    expect(setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: 'claude-session',
      configId: 'model',
      value: 'opus',
    });
  });

  it('keeps the adapter default when the requested model is not advertised', async () => {
    const setSessionConfigOption = jest.fn();
    const session = {
      id: 'bridge-session',
      acpSessionId: 'claude-session',
      connection: { setSessionConfigOption },
    } as any;

    await (service as any).applySessionModel(session, [{ id: 'model', currentValue: 'default', options: [{ value: 'sonnet', name: 'Claude Sonnet' }] }], 'not-a-real-model');

    expect(setSessionConfigOption).not.toHaveBeenCalled();
  });
});
