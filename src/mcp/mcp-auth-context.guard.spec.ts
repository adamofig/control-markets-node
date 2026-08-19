import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { McpAuthContextGuard } from './mcp-auth-context.guard';
import { requireMcpContext, resolveOrgArgument, scopeMcpOperation, scopedQuery, stripPrivilegeFields, requirePlatformAdminForWrite } from './mcp-scope.util';
import { ALL_MCP_SCOPES, MCP_SCOPES } from './mcp-scopes';

const contextFor = (request: any) => ({ switchToHttp: () => ({ getRequest: () => request }) }) as any;

/** A Fastify request: guards decorate the outer object, tools receive `raw`. That gap is the point. */
const fastifyRequest = (over: any = {}) => ({
  decodedToken: { uid: 'u1', email: 'adamo@control.markets' },
  ctx: { userId: 'u1', email: 'adamo@control.markets', orgId: 'org-a', role: 'admin', permissions: [], isPlatformAdmin: false, isPersonalSpace: false },
  authMethod: 'pat',
  raw: {},
  ...over,
});

describe('McpAuthContextGuard', () => {
  const guard = new McpAuthContextGuard();

  it('refuses a request with no identity', () => {
    expect(() => guard.canActivate(contextFor(fastifyRequest({ decodedToken: undefined })))).toThrow(UnauthorizedException);
  });

  it('refuses an authenticated request with no resolvable organization', () => {
    expect(() => guard.canActivate(contextFor(fastifyRequest({ ctx: undefined, orgId: undefined })))).toThrow(ForbiddenException);
  });

  it('falls back to request.orgId when OrgContextGuard resolved no ctx', () => {
    const request = fastifyRequest({ ctx: undefined, orgId: 'org-fallback' });
    guard.canActivate(contextFor(request));
    expect(requireMcpContext(request.raw).orgId).toBe('org-fallback');
  });

  describe('ephemeral agent tokens (task 25)', () => {
    const grant = (over: any = {}) => ({
      orgId: 'org-a',
      profileId: 'borges',
      sessionId: 'session-1',
      scopes: [MCP_SCOPES.resources, MCP_SCOPES.tasks],
      expiresAt: Date.now() + 60_000,
      fingerprint: 'abc123def456',
      ...over,
    });

    it('a human credential keeps every scope', () => {
      const request = fastifyRequest();
      guard.canActivate(contextFor(request));
      expect(requireMcpContext(request.raw).scopes).toEqual(ALL_MCP_SCOPES);
      expect((request.raw as any).user.scopes).toEqual(ALL_MCP_SCOPES);
    });

    it('an agent session carries only the scopes it was minted with', () => {
      const request = fastifyRequest({ authMethod: 'ephemeral-agent', agentGrant: grant() });
      guard.canActivate(contextFor(request));

      // `raw.user.scopes` is not bookkeeping: it is what mcp-nest compares against each tool's
      // `@ToolScopes`, both to build `tools/list` and to refuse a `tools/call`.
      expect((request.raw as any).user.scopes).toEqual([MCP_SCOPES.resources, MCP_SCOPES.tasks]);
      expect(requireMcpContext(request.raw).agentSessionId).toBe('session-1');
    });

    it('refuses a request that resolved to an organization the grant does not name', () => {
      // The escape route being closed: `OrgContextGuard` prefers `x-org-id` over the org the token
      // pinned, which is right for a human switching workspace and wrong for a session credential.
      const request = fastifyRequest({
        authMethod: 'ephemeral-agent',
        agentGrant: grant({ orgId: 'org-b' }),
      });
      expect(() => guard.canActivate(contextFor(request))).toThrow(ForbiddenException);
      // Refused, not silently corrected — a tool acting on a different org than the token names is
      // the exact failure this whole task exists to prevent.
      expect((request.raw as any).mcpAuthContext).toBeUndefined();
    });

    it('does not leak the Mongo user document into what mcp-nest authorizes on', () => {
      const request = fastifyRequest({ user: { email: 'adamo@control.markets', token: 'cm_pat_secret', claims: { roles: { admin: null } } } });
      guard.canActivate(contextFor(request));
      // The forwarded object used to be the user document verbatim, which has no `scopes` field —
      // so every tool passed the check for everyone.
      expect((request.raw as any).user.scopes).toBeDefined();
    });
  });

  /**
   * The reason this guard exists. Under Fastify the tools receive `request.raw` — a different object
   * from the one F12's guards decorated. Without the bridge, everything the guards resolved is
   * invisible from inside a tool, and scoping them is not hard but impossible.
   */
  it('bridges the identity onto raw, which is what a tool actually receives', () => {
    const request = fastifyRequest();
    expect((request.raw as any).mcpAuthContext).toBeUndefined();

    guard.canActivate(contextFor(request));

    expect(requireMcpContext(request.raw)).toMatchObject({
      orgId: 'org-a',
      email: 'adamo@control.markets',
      role: 'admin',
      isPlatformAdmin: false,
      authMethod: 'pat',
    });
  });
});

describe('mcp-scope.util', () => {
  const guard = new McpAuthContextGuard();
  const identityFor = (over: any = {}) => {
    const request = fastifyRequest({ ctx: { ...fastifyRequest().ctx, ...over } });
    guard.canActivate(contextFor(request));
    return requireMcpContext(request.raw);
  };

  describe('requireMcpContext fails closed', () => {
    it('throws when the guard never ran — a tool must not run unscoped', () => {
      expect(() => requireMcpContext({})).toThrow(UnauthorizedException);
      expect(() => requireMcpContext(undefined)).toThrow(UnauthorizedException);
    });
  });

  describe('scopeMcpOperation rewrites through the shared F14a rulebook', () => {
    it('forces the org on a find, overwriting what the model asked for', () => {
      const operation: any = { action: 'find', query: { orgId: 'org-b', status: 'pending' } };
      scopeMcpOperation(operation, identityFor(), 'tasks_operation');
      expect(operation.query).toEqual({ orgId: 'org-a', status: 'pending' });
    });

    it('stamps the org on a create', () => {
      const operation: any = { action: 'create', payload: { name: 'x' } };
      scopeMcpOperation(operation, identityFor(), 'tasks_operation');
      expect(operation.payload.orgId).toBe('org-a');
    });

    it('prepends a $match to an aggregate, where nothing can widen it', () => {
      const operation: any = { action: 'aggregate', payload: [{ $group: { _id: '$status' } }] };
      scopeMcpOperation(operation, identityFor(), 'tasks_jobsOperation');
      expect(operation.payload[0]).toEqual({ $match: { orgId: 'org-a' } });
    });

    it('strips a foreign org from an update instead of writing ours in', () => {
      // Writing ours in would move somebody else's row into our organization — a takeover primitive.
      const operation: any = { action: 'updateOne', query: {}, payload: { $set: { orgId: 'org-b', name: 'x' } } };
      scopeMcpOperation(operation, identityFor(), 'tasks_operation');
      expect(operation.payload.$set).toEqual({ name: 'x' });
      expect(operation.query.orgId).toBe('org-a');
    });

    it('scopes by a different field when the collection links differently', () => {
      const operation: any = { action: 'find', query: {} };
      scopeMcpOperation(operation, identityFor(), 'users_operation', 'organizations.orgId');
      expect(operation.query).toEqual({ 'organizations.orgId': 'org-a' });
    });

    it('honours the platform-admin escape hatch, and only for platform admins', () => {
      const asAdmin: any = { action: 'find', query: {}, options: { adminBypass: true } };
      scopeMcpOperation(asAdmin, identityFor({ isPlatformAdmin: true }), 'tasks_operation');
      expect(asAdmin.query.orgId).toBeUndefined();

      const asMember: any = { action: 'find', query: {}, options: { adminBypass: true } };
      scopeMcpOperation(asMember, identityFor(), 'tasks_operation');
      expect(asMember.query.orgId).toBe('org-a');
    });
  });

  describe('resolveOrgArgument — the argument is a request, not an assertion', () => {
    it('defaults to the caller organization when absent', () => {
      expect(resolveOrgArgument(undefined, identityFor(), 'messaging_notifyUser')).toBe('org-a');
    });

    it('accepts the caller own organization', () => {
      expect(resolveOrgArgument('org-a', identityFor(), 'messaging_notifyUser')).toBe('org-a');
    });

    it('refuses a foreign organization for a member', () => {
      expect(() => resolveOrgArgument('org-b', identityFor(), 'messaging_notifyUser')).toThrow(ForbiddenException);
    });

    it('allows a platform admin to cross, which is what the admin screens need', () => {
      expect(resolveOrgArgument('org-b', identityFor({ isPlatformAdmin: true }), 'org_getMembers')).toBe('org-b');
    });
  });

  describe('platform collections', () => {
    it('lets a member read but not write', () => {
      expect(() => requirePlatformAdminForWrite({ action: 'find' }, identityFor(), 'users_operation', '`org_operateUser`')).not.toThrow();
      expect(() => requirePlatformAdminForWrite({ action: 'updateMany' }, identityFor(), 'users_operation', '`org_operateUser`')).toThrow(ForbiddenException);
    });

    it('lets a platform admin write', () => {
      expect(() =>
        requirePlatformAdminForWrite({ action: 'updateMany' }, identityFor({ isPlatformAdmin: true }), 'users_operation', '`org_operateUser`'),
      ).not.toThrow();
    });
  });

  describe('stripPrivilegeFields closes the self-promotion path', () => {
    it('removes claims and memberships from a member update', () => {
      const payload = { 'personalData.nickname': 'Dev', claims: { roles: { admin: null } }, organizations: [{ orgId: 'org-b' }] };
      expect(stripPrivilegeFields(payload, identityFor(), 'users_updateByEmail')).toEqual({ 'personalData.nickname': 'Dev' });
    });

    it('removes dotted paths into those fields too', () => {
      const payload = { 'claims.roles.admin': null, 'settings.baseLanguage': 'es' };
      expect(stripPrivilegeFields(payload, identityFor(), 'users_updateByEmail')).toEqual({ 'settings.baseLanguage': 'es' });
    });

    it('leaves a platform admin payload untouched', () => {
      const payload = { claims: { roles: { admin: null } } };
      expect(stripPrivilegeFields(payload, identityFor({ isPlatformAdmin: true }), 'users_updateByEmail')).toEqual(payload);
    });
  });

  it('scopedQuery adds the org without dropping the caller filters', () => {
    expect(scopedQuery(identityFor(), { status: 'draft' })).toEqual({ status: 'draft', orgId: 'org-a' });
  });
});
