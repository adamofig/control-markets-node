// Deep import: the class is internal to the package's public entry point, which is itself the
// point — this test exists precisely because the mechanism is not part of a stable public API.
import { ToolAuthorizationService } from '@rekog/mcp-nest/dist/mcp/services/tool-authorization.service';
import { ALL_MCP_SCOPES, DEFAULT_AGENT_SESSION_SCOPES, MCP_SCOPES, MCP_TOOLS_BY_SCOPE, toolNamesForScopes } from './mcp-scopes';

/**
 * The assumption task 25 rests on, checked against the library that implements it.
 *
 * The tool allow-list of an ephemeral token is not enforced by any code of ours: it is
 * `@rekog/mcp-nest` comparing each tool's `requiredScopes` (from `@ToolScopes`) against
 * `raw.user.scopes` (which `McpAuthContextGuard` writes) — in `tools/list` to build the catalogue,
 * and again in `tools/call` to refuse. Everything else in this task assumes that behaviour, and it
 * lives in a dependency that can change under a `pnpm update`. So it is pinned here.
 */
describe('MCP scope enforcement (the mechanism, not our copy of it)', () => {
  const auth = new ToolAuthorizationService();

  /** A tool as the library sees it after discovery. */
  const tool = (name: string, requiredScopes: string[]) => ({ metadata: { name, requiredScopes } }) as any;

  const cmRead = tool('cm_read', [MCP_SCOPES.resources]);
  const updateUser = tool('users_updateByEmail', [MCP_SCOPES.users]);

  const agentSession = { scopes: DEFAULT_AGENT_SESSION_SCOPES } as any;
  const human = { scopes: ALL_MCP_SCOPES } as any;

  it('lets an agent session reach the tools its grant names', () => {
    expect(auth.canAccessTool(agentSession, cmRead, true)).toBe(true);
  });

  it('keeps an agent session out of the tools its grant does not name', () => {
    // The concrete thing being prevented: an unattended cron wake-up rewriting a user document
    // because it happened to be given a chat window.
    expect(auth.canAccessTool(agentSession, updateUser, true)).toBe(false);
  });

  it('refuses the call too, not only the listing', () => {
    // A filtered catalogue is a hint, not a boundary — a model can name a tool it was never shown.
    expect(() => auth.validateToolAccess(agentSession, updateUser, true)).toThrow(/requires scopes/);
    expect(() => auth.validateToolAccess(agentSession, cmRead, true)).not.toThrow();
  });

  it('changes nothing for a human credential', () => {
    expect(auth.canAccessTool(human, cmRead, true)).toBe(true);
    expect(auth.canAccessTool(human, updateUser, true)).toBe(true);
  });

  it('refuses a caller with no scopes at all', () => {
    // Which is what a credential minted before this vocabulary existed would look like.
    expect(auth.canAccessTool({ scopes: [] } as any, cmRead, true)).toBe(false);
    expect(auth.canAccessTool(undefined, cmRead, true)).toBe(false);
  });

  it('the default agent grant is a real reduction, not a formality', () => {
    const granted = toolNamesForScopes(DEFAULT_AGENT_SESSION_SCOPES);
    const everything = Object.values(MCP_TOOLS_BY_SCOPE).flat();
    expect(granted.length).toBe(8);
    expect(everything.length).toBe(30);
  });
});
