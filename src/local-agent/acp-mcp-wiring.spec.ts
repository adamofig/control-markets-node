import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildAcpMcpServers, CM_MCP_SERVER_NAME, ensureAgyMcpConfig, planMcpWiring, resolveAgyShimPath, resolveMcpUrl } from './acp-mcp-wiring';
import { MCP_SCOPES } from '../mcp/mcp-scopes';

describe('ACP ↔ MCP wiring', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('planMcpWiring', () => {
    it('gives no tools to a session with no organization', () => {
      // The load-bearing refusal: every tool derives its tenant from the token, so a session that
      // cannot name an organization has nothing that could be safely scoped.
      expect(planMcpWiring('acp-http', undefined)).toBeNull();
    });

    it('gives no tools to an engine that cannot be told about an MCP server', () => {
      expect(planMcpWiring(undefined, 'org-a')).toBeNull();
    });

    it('is off entirely when AGENT_MCP_ENABLED is false', () => {
      process.env.AGENT_MCP_ENABLED = 'false';
      expect(planMcpWiring('acp-http', 'org-a')).toBeNull();
    });

    it('names the tools the default scopes unlock, and only those', () => {
      const plan = planMcpWiring('acp-http', 'org-a')!;
      expect(plan.scopes).toEqual([MCP_SCOPES.resources, MCP_SCOPES.tasks]);
      expect(plan.toolNames).toContain('cm_read');
      // What the index must never promise to an unattended run.
      expect(plan.toolNames).not.toContain('users_updateByEmail');
      expect(plan.toolNames).not.toContain('social_createPost');
    });

    it('widens deliberately through AGENT_SESSION_MCP_SCOPES', () => {
      process.env.AGENT_SESSION_MCP_SCOPES = 'cm:resources,cm:social';
      const plan = planMcpWiring('acp-http', 'org-a')!;
      expect(plan.toolNames).toContain('social_createPost');
      expect(plan.toolNames).not.toContain('tasks_operation');
    });

    it('falls back to the default rather than to nothing when the env var is nonsense', () => {
      process.env.AGENT_SESSION_MCP_SCOPES = 'cm:everything';
      expect(planMcpWiring('acp-http', 'org-a')!.scopes).toEqual([MCP_SCOPES.resources, MCP_SCOPES.tasks]);
    });
  });

  describe('resolveMcpUrl', () => {
    it('points at loopback, not at the public hostname', () => {
      delete process.env.AGENT_MCP_URL;
      // Traffic born and dying inside the container has no business going through Cloudflare, and a
      // session credential has no business travelling a public path.
      expect(resolveMcpUrl()).toBe('http://127.0.0.1:8121/mcp');
    });

    it('honours an explicit override', () => {
      process.env.AGENT_MCP_URL = 'http://backend:8121/mcp';
      expect(resolveMcpUrl()).toBe('http://backend:8121/mcp');
    });
  });

  describe('resolveAgyShimPath', () => {
    it('finds the shim that agy will actually spawn', () => {
      // The path is walked up from `__dirname` rather than hardcoded, because the webpack build
      // collapses everything into `dist/main.js` and a build-time constant would be wrong there.
      // A path that does not exist would register a config entry agy cannot run.
      const shim = resolveAgyShimPath();
      expect(shim.endsWith(join('scripts', 'agy-acp', 'cm-mcp-stdio.mjs'))).toBe(true);
      expect(existsSync(shim)).toBe(true);
    });
  });

  describe('buildAcpMcpServers', () => {
    it('puts the token in a header, never in the URL', () => {
      const plan = planMcpWiring('acp-http', 'org-a')!;
      const [descriptor] = buildAcpMcpServers(plan, 'cm_eat_abc');

      expect(descriptor).toMatchObject({ type: 'http', name: CM_MCP_SERVER_NAME, url: plan.url });
      expect(descriptor.headers).toEqual([{ name: 'Authorization', value: 'Bearer cm_eat_abc' }]);
      expect(descriptor.url).not.toContain('cm_eat_abc');
    });
  });

  describe('ensureAgyMcpConfig', () => {
    let dir: string;
    let configPath: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'agy-mcp-config-'));
      configPath = join(dir, 'mcp_config.json');
    });

    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('creates the entry when there is no config yet', () => {
      expect(ensureAgyMcpConfig('/shim.mjs', configPath)).toBe(true);
      const written = JSON.parse(readFileSync(configPath, 'utf8'));
      expect(written.mcpServers[CM_MCP_SERVER_NAME]).toEqual({ command: process.execPath, args: ['/shim.mjs'] });
    });

    it('never writes the credential to disk', () => {
      ensureAgyMcpConfig('/shim.mjs', configPath);
      // The whole reason the token travels in the environment: this file is global to the host and
      // shared by every session on it.
      expect(readFileSync(configPath, 'utf8')).not.toContain('cm_eat_');
    });

    it('preserves the servers and settings somebody else put there', () => {
      writeFileSync(configPath, JSON.stringify({ someSetting: true, mcpServers: { gitnexus: { command: 'gitnexus', args: ['mcp'] } } }));

      ensureAgyMcpConfig('/shim.mjs', configPath);

      const written = JSON.parse(readFileSync(configPath, 'utf8'));
      expect(written.someSetting).toBe(true);
      expect(written.mcpServers.gitnexus).toEqual({ command: 'gitnexus', args: ['mcp'] });
      expect(written.mcpServers[CM_MCP_SERVER_NAME]).toBeDefined();
    });

    it('leaves a malformed file untouched and reports failure', () => {
      writeFileSync(configPath, '{ this is not json');

      // Overwriting would delete a hand-edit in progress along with every other server in it. The
      // honest outcome is an agy session with no Control Markets tools.
      expect(ensureAgyMcpConfig('/shim.mjs', configPath)).toBe(false);
      expect(readFileSync(configPath, 'utf8')).toBe('{ this is not json');
    });

    it('is idempotent — a correct entry is left exactly as it is', () => {
      ensureAgyMcpConfig('/shim.mjs', configPath);
      const first = readFileSync(configPath, 'utf8');

      expect(ensureAgyMcpConfig('/shim.mjs', configPath)).toBe(true);
      expect(readFileSync(configPath, 'utf8')).toBe(first);
    });
  });
});
