import { EphemeralAgentTokenService, EPHEMERAL_AGENT_TOKEN_PREFIX } from './ephemeral-agent-token.service';
import { MCP_SCOPES } from '../mcp/mcp-scopes';

/**
 * The credential task 25 hands to a subprocess. What is asserted here is what makes it safe to hand
 * over at all: it dies, it is confined to one organization, and it carries less power than the human
 * whose session produced it.
 */
describe('EphemeralAgentTokenService', () => {
  let service: EphemeralAgentTokenService;

  beforeEach(() => {
    service = new EphemeralAgentTokenService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  const mint = (overrides: Partial<Parameters<EphemeralAgentTokenService['mint']>[0]> = {}) =>
    service.mint({ orgId: 'org-a', sessionId: 'session-1', email: 'adamo@control.markets', ...overrides });

  it('mints a prefixed token that resolves to its grant', () => {
    const { token, grant } = mint({ profileId: 'borges' });

    expect(token.startsWith(EPHEMERAL_AGENT_TOKEN_PREFIX)).toBe(true);
    expect(service.resolve(token)).toMatchObject({ orgId: 'org-a', profileId: 'borges', sessionId: 'session-1' });
    // The raw value is never stored, so it cannot leak from the service afterwards.
    expect(JSON.stringify(grant)).not.toContain(token);
  });

  it('defaults to the read-and-tasks scopes, not to everything', () => {
    const { grant } = mint();
    expect(grant.scopes).toEqual([MCP_SCOPES.resources, MCP_SCOPES.tasks]);
    expect(grant.scopes).not.toContain(MCP_SCOPES.users);
  });

  it('refuses a token it never issued, and one from another instance', () => {
    const { token } = mint();
    expect(service.resolve(`${EPHEMERAL_AGENT_TOKEN_PREFIX}deadbeef`)).toBeNull();
    expect(service.resolve('cm_pat_something')).toBeNull();
    expect(service.resolve(undefined)).toBeNull();
    expect(new EphemeralAgentTokenService().resolve(token)).toBeNull();
  });

  it('stops resolving once the TTL has passed', () => {
    jest.useFakeTimers();
    const { token } = mint({ ttlMs: 60_000 });

    expect(service.resolve(token)).not.toBeNull();
    jest.advanceTimersByTime(61_000);
    // The point of the expiry: an agent that outlives its session degrades to "no tools" instead of
    // holding a working key to the platform.
    expect(service.resolve(token)).toBeNull();
  });

  it('caps the requested lifetime instead of trusting the caller', () => {
    const { grant } = mint({ ttlMs: 999 * 60 * 60 * 1000 });
    expect(grant.expiresAt - Date.now()).toBeLessThanOrEqual(6 * 60 * 60 * 1000 + 1_000);
  });

  it('revokes every grant of a session, including one minted by a respawn', () => {
    const first = mint();
    const second = mint();
    const other = mint({ sessionId: 'session-2' });

    expect(service.revokeSession('session-1')).toBe(2);
    expect(service.resolve(first.token)).toBeNull();
    expect(service.resolve(second.token)).toBeNull();
    expect(service.resolve(other.token)).not.toBeNull();
  });

  it('drops every grant when the process is going down', () => {
    const { token } = mint();
    service.onModuleDestroy();
    // Every ACP subprocess died with the process; a resolvable token would be a key to nothing.
    expect(service.resolve(token)).toBeNull();
    expect(service.size).toBe(0);
  });
});
