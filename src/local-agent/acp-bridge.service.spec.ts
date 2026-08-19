jest.mock('./filesystem-tools.service', () => ({ FilesystemToolsService: class {} }));

import { AcpBridgeService } from './acp-bridge.service';
import { EphemeralAgentTokenService } from '../user/ephemeral-agent-token.service';

describe('AcpBridgeService Claude ACP integration', () => {
  let service: AcpBridgeService;

  beforeEach(() => {
    service = new AcpBridgeService({ enabled: true } as any, new EphemeralAgentTokenService());
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

  it('reports each turn increment, not the cumulative session cost', () => {
    // ACP `usage_update.cost` is the cumulative session cost. These are the real values captured
    // from conversation 6a727c1e027fe16e6b8858c5: the second turn reported $0.4313465 while its
    // own cost was only $0.0608815. Storing the raw amount made every turn show the session total.
    const session = {} as any;

    (service as any).mapUpdate(session, { sessionUpdate: 'usage_update', cost: { amount: 0.370465, currency: 'USD' } });
    expect(session.turnCostUsd).toBeCloseTo(0.370465, 7);

    session.turnCostUsd = undefined; // next turn begins
    (service as any).mapUpdate(session, { sessionUpdate: 'usage_update', cost: { amount: 0.4313465, currency: 'USD' } });

    expect(session.turnCostUsd).toBeCloseTo(0.0608815, 7);
    expect(session.reportedCumulativeCostUsd).toBeCloseTo(0.4313465, 7);
  });

  it('treats a cost below the previous reading as a restarted counter', () => {
    const session = { reportedCumulativeCostUsd: 0.5 } as any;

    (service as any).mapUpdate(session, { sessionUpdate: 'usage_update', cost: { amount: 0.02, currency: 'USD' } });

    // A respawn resets the agent's counter; the amount is the increment, never a negative delta.
    expect(session.turnCostUsd).toBeCloseTo(0.02, 7);
    expect(session.reportedCumulativeCostUsd).toBeCloseTo(0.02, 7);
  });

  it('keeps autonomous cost out of the next user turn increment', () => {
    const session = {} as any;

    (service as any).mapUpdate(session, { sessionUpdate: 'usage_update', cost: { amount: 0.1, currency: 'USD' } });
    (service as any).mapUpdate(session, {
      sessionUpdate: 'usage_update',
      cost: { amount: 0.15, currency: 'USD' },
      _meta: { '_claude/origin': { kind: 'subagent' } },
    });

    session.turnCostUsd = undefined; // next user turn begins
    (service as any).mapUpdate(session, { sessionUpdate: 'usage_update', cost: { amount: 0.2, currency: 'USD' } });

    // 0.20 − 0.15, not 0.20 − 0.10: the autonomous increment advanced the cumulative counter, so it
    // is excluded from this turn instead of leaking into it.
    expect(session.turnCostUsd).toBeCloseTo(0.05, 7);
  });

  it('ignores usage updates without a finite USD amount', () => {
    const session = { reportedCumulativeCostUsd: 0.3 } as any;

    (service as any).mapUpdate(session, { sessionUpdate: 'usage_update', cost: { amount: 120, currency: 'MXN' } });
    (service as any).mapUpdate(session, { sessionUpdate: 'usage_update', used: 10, size: 200_000 });

    expect(session.turnCostUsd).toBeUndefined();
    expect(session.reportedCumulativeCostUsd).toBe(0.3);
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

    await (service as any).applySessionConfigOption(session, configOptions, 'model', 'opus');

    expect(setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: 'claude-session',
      configId: 'model',
      value: 'opus',
    });
  });

  it('selects the reasoning effort advertised by the agy adapter', async () => {
    const setSessionConfigOption = jest.fn().mockResolvedValue({ configOptions: [] });
    const session = { id: 'bridge-session', acpSessionId: 'agy-session', connection: { setSessionConfigOption } } as any;
    const configOptions = [
      { id: 'model', currentValue: 'gemini-3.6-flash', options: [{ value: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash' }] },
      { id: 'effort', currentValue: 'high', options: [{ value: 'low', name: 'Low' }, { value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }] },
    ];

    await (service as any).applySessionConfigOption(session, configOptions, 'effort', 'low');

    expect(setSessionConfigOption).toHaveBeenCalledWith({ sessionId: 'agy-session', configId: 'effort', value: 'low' });
  });

  it('keeps the adapter default when the requested model is not advertised', async () => {
    const setSessionConfigOption = jest.fn();
    const session = {
      id: 'bridge-session',
      acpSessionId: 'claude-session',
      connection: { setSessionConfigOption },
    } as any;

    await (service as any).applySessionConfigOption(session, [{ id: 'model', currentValue: 'default', options: [{ value: 'sonnet', name: 'Claude Sonnet' }] }], 'model', 'not-a-real-model');

    expect(setSessionConfigOption).not.toHaveBeenCalled();
  });
});
