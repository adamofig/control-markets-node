// FilesystemToolsService pulls in the ESM-only `ai` package, which Jest cannot parse.
jest.mock('./filesystem-tools.service', () => ({ FilesystemToolsService: class {} }));

import * as fs from 'fs';
import * as path from 'path';
import { AcpBridgeService } from './acp-bridge.service';
import { EphemeralAgentTokenService } from '../user/ephemeral-agent-token.service';
import { CM_MCP_SERVER_NAME, planMcpWiring } from './acp-mcp-wiring';

/**
 * Task 25 — the line the whole task was about: `mcpServers: []`, written out three times.
 */
describe('AcpBridgeService · MCP wiring', () => {
  let service: AcpBridgeService;
  let tokens: EphemeralAgentTokenService;

  beforeEach(() => {
    tokens = new EphemeralAgentTokenService();
    service = new AcpBridgeService({ enabled: true, workspaceRoots: [] } as any, tokens);
  });

  afterEach(() => {
    service.onModuleDestroy();
    tokens.onModuleDestroy();
  });

  const buildMcpServers = (session: any, plan: any) => (service as any).buildMcpServers(session, plan);

  it('returns no servers when the session has no token', () => {
    const plan = planMcpWiring('acp-http', 'org-a');
    expect(buildMcpServers({ mcpToken: undefined }, plan)).toEqual([]);
  });

  it('returns no servers when there is no plan at all', () => {
    expect(buildMcpServers({ mcpToken: 'cm_eat_x' }, null)).toEqual([]);
  });

  it('returns the descriptor once both a plan and a token exist', () => {
    const plan = planMcpWiring('acp-http', 'org-a');
    const [descriptor] = buildMcpServers({ mcpToken: 'cm_eat_x' }, plan);
    expect(descriptor).toMatchObject({ type: 'http', name: CM_MCP_SERVER_NAME });
    expect(descriptor.headers[0].value).toBe('Bearer cm_eat_x');
  });

  it('sends no descriptor to agy even when its wiring succeeded', () => {
    // agy ignores ACP's `mcpServers` and reads its own config file. Sending the descriptor anyway
    // would write the token into session state the CLI persists, for no benefit whatsoever.
    const plan = planMcpWiring('agy-config-stdio', 'org-a');
    expect(buildMcpServers({ mcpToken: 'cm_eat_x' }, plan)).toEqual([]);
  });

  describe('describeRuntime', () => {
    it('promises no tools to a session with no organization', () => {
      expect(service.describeRuntime('claude').tools).toEqual([]);
    });

    it('names the tools an organization-bound session will get', () => {
      const runtime = service.describeRuntime('agy', undefined, { orgId: 'org-a' });
      expect(runtime.tools).toContain('cm_read');
      expect(runtime.tools).not.toContain('users_updateByEmail');
    });
  });

  describe('the three lifecycle call sites', () => {
    const source = fs.readFileSync(path.join(__dirname, 'acp-bridge.service.ts'), 'utf8');
    // Read line by line rather than as one blob: the doc block above `describeRuntime` quotes the
    // old literal to explain what changed, and a test that forbade naming the past would forbid
    // documenting it.
    const callLines = source.split('\n').filter(line => /connection\.(loadSession|resumeSession|newSession)\(\{/.test(line));

    it('are still exactly three', () => {
      expect(callLines).toHaveLength(3);
    });

    it('all take the value built by buildMcpServers, and none hard-code an empty list', () => {
      // Three copies of one constant is how three call sites start disagreeing.
      for (const line of callLines) {
        expect(line).toContain('mcpServers: servers');
        expect(line).not.toContain('mcpServers: []');
      }
    });
  });

  it('revokes the session credential when the session is disposed', () => {
    const { token } = tokens.mint({ orgId: 'org-a', sessionId: 'session-1' });
    const session = { id: 'session-1', mcpToken: token, process: { kill: jest.fn() } } as any;

    (service as any).disposeSession(session);

    // A killed subprocess with a live grant is a bearer token with nothing behind it.
    expect(session.process.kill).toHaveBeenCalledWith('SIGTERM');
    expect(tokens.resolve(token)).toBeNull();
    expect(session.mcpToken).toBeUndefined();
  });
});
