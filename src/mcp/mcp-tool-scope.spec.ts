import * as fs from 'fs';
import * as path from 'path';

/**
 * The test that keeps task 6 from rotting — the same shape as `route-guards.spec.ts` does for F10.
 *
 * Every `@Tool` in `src/mcp/` must take the request and resolve its organization from it. Adding a
 * tool without that is not caught by `tsc`, by `nest build`, or by any behavioral test: the tool
 * simply works, and quietly works across every tenant. That is exactly how the seven tools this task
 * fixed came to exist — nobody decided they should be unscoped, nobody was measuring.
 *
 * It reads source rather than booting the container, for the reason `route-guards.spec.ts` gives:
 * booting `AppModule` needs Mongo, Firebase and half a dozen services, so the test would be skipped
 * in CI on the first bad day and stop protecting anything.
 */
describe('MCP tool org-scope coverage (task 6)', () => {
  const MCP_DIR = __dirname;

  /** Helpers that constitute "this tool resolved its org from the token, not from its arguments". */
  const SCOPE_CALLS = [
    'requireMcpContext',
    'assertOwned',
    'assertTaskOwned',
    'assertShareOrg',
    'moveNodesForOrganization',
  ];

  /**
   * Tools that legitimately read no collection, with the reason. Anything else must scope.
   * A new entry here is a decision someone has to write down and defend in review.
   */
  const NO_COLLECTION_TOOLS = new Map<string, string>([
    ['tasks_getSchema', 'returns a static description of the agent_tasks shape — no query runs'],
  ]);

  function toolFiles(): string[] {
    return fs
      .readdirSync(MCP_DIR)
      .filter(name => name.endsWith('.tools.ts') && !name.endsWith('.spec.ts'))
      .map(name => path.join(MCP_DIR, name));
  }

  /** Splits a tools file into one block per `@Tool({...})` + the method that follows it. */
  function toolBlocks(source: string): { name: string; body: string }[] {
    const blocks: { name: string; body: string }[] = [];
    const lines = source.split('\n');
    let start = -1;

    for (let i = 0; i < lines.length; i++) {
      if (/^\s*@Tool\(\{/.test(lines[i])) {
        if (start >= 0) blocks.push(buildBlock(lines, start, i));
        start = i;
      }
    }
    if (start >= 0) blocks.push(buildBlock(lines, start, lines.length));
    return blocks;
  }

  function buildBlock(lines: string[], from: number, to: number): { name: string; body: string } {
    const body = lines.slice(from, to).join('\n');
    const name = /name:\s*'([^']+)'/.exec(body)?.[1] ?? `(unnamed @Tool at line ${from + 1})`;
    return { name, body };
  }

  const allTools = toolFiles().flatMap(file =>
    toolBlocks(fs.readFileSync(file, 'utf8')).map(block => ({ ...block, file: path.basename(file) })),
  );

  it('finds the tool surface it is supposed to be guarding', () => {
    // A refactor that renames the files must not turn this suite into a silent no-op.
    expect(allTools.length).toBeGreaterThanOrEqual(20);
  });

  it.each(allTools.map(t => [t.name, t]))('%s receives the HTTP request', (_name, tool: any) => {
    // Third positional parameter of the handler — how `mcp-nest` passes `httpRequest.raw`. Without
    // it a tool has no way to know who is calling, whatever else it does.
    expect({ tool: tool.name, file: tool.file, takesRequest: /request: any/.test(tool.body) }).toEqual({
      tool: tool.name,
      file: tool.file,
      takesRequest: true,
    });
  });

  it.each(allTools.map(t => [t.name, t]))('%s resolves its organization from the token', (_name, tool: any) => {
    const exempt = NO_COLLECTION_TOOLS.has(tool.name);
    const scoped = SCOPE_CALLS.some(call => tool.body.includes(call));
    expect({ tool: tool.name, file: tool.file, scopedOrExempt: scoped || exempt }).toEqual({
      tool: tool.name,
      file: tool.file,
      scopedOrExempt: true,
    });
  });

  it('no tool accepts a required orgId argument', () => {
    // The three tools that still name an organization take it as *optional* and run it through
    // `resolveOrgArgument`, which refuses a foreign one unless the caller is a platform admin. A
    // required `orgId: z.string()` is the old contract, where the model decided the tenant.
    const offenders = allTools
      .filter(tool => /orgId:\s*z\.string\(\)\.describe/.test(tool.body))
      .map(tool => `${tool.file}:${tool.name}`);
    expect(offenders).toEqual([]);
  });

  it('every tool naming an organization runs it through resolveOrgArgument', () => {
    const offenders = allTools
      .filter(tool => /orgId:\s*z\.string\(\)/.test(tool.body) && !tool.body.includes('resolveOrgArgument'))
      .map(tool => `${tool.file}:${tool.name}`);
    expect(offenders).toEqual([]);
  });

  it('the guard is registered on the /mcp route', () => {
    // `McpModule.forRoot({ guards })` does not add its guards to `providers`, and Nest silently
    // skips a guard it cannot resolve. This asserts the registration exists at all; the tools fail
    // closed on their own if it ever stops running.
    const appModule = fs.readFileSync(path.join(MCP_DIR, '..', 'app.module.ts'), 'utf8');
    expect(appModule).toContain('guards: [McpAuthContextGuard]');
  });

  it('the dead MCP_API_KEY guard is gone', () => {
    // It was never wired to anything and made `/mcp` look protected by a shared key. Dead security
    // code answers "is this protected?" with a confident wrong yes.
    expect(fs.existsSync(path.join(MCP_DIR, 'mcp-auth.guard.ts'))).toBe(false);
  });
});
