import { ForbiddenException } from '@nestjs/common';
import { OrgContextGuard } from './org-context.guard';
import { OrgContextService } from './org-context.service';
import { OrgRole } from 'src/user/user.class';
import { ORG_PERMISSION_KEY, ORG_ROLE_KEY } from './org-permission.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * F11 — the tests that give the frontend gating its backing. Every "the UI hides this button" claim
 * from F8/F9 is only true if the matching request is refused here.
 */
describe('OrgContextGuard (F11)', () => {
  const OWNER = { _id: { toString: () => 'user-owner' }, id: 'user-owner', email: 'owner@cm.com', defaultOrgId: 'org-a', organizations: [{ orgId: 'org-a', name: 'A', role: OrgRole.Owner }] };
  const VIEWER = { _id: { toString: () => 'user-viewer' }, id: 'user-viewer', email: 'viewer@cm.com', defaultOrgId: 'org-a', organizations: [{ orgId: 'org-a', name: 'A', role: OrgRole.Viewer }] };
  const OUTSIDER = { _id: { toString: () => 'user-out' }, id: 'user-out', email: 'out@cm.com', defaultOrgId: 'org-z', organizations: [{ orgId: 'org-z', name: 'Z', role: OrgRole.Owner }] };

  function build(user: any, metadata: Record<string, any>) {
    const userService = { findUserByEmail: jest.fn().mockResolvedValue(user) } as any;
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => metadata[key]),
    } as any;
    return new OrgContextGuard(reflector, new OrgContextService(userService));
  }

  function contextFor(email: string, params: Record<string, string> = {}, headers: Record<string, string> = {}, claims: any = {}) {
    const request: any = {
      headers,
      params,
      method: 'POST',
      url: '/api/organization/org-a/operate-user',
      decodedToken: { email, ...claims },
    };
    return { request, ctx: { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => () => undefined, getClass: () => class {} } as any };
  }

  it('lets an Owner manage members of their organization', async () => {
    const guard = build(OWNER, { [ORG_PERMISSION_KEY]: { permission: 'members:manage', orgIdParam: 'orgId' } });
    const { request, ctx } = contextFor(OWNER.email, { orgId: 'org-a' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.ctx.role).toBe(OrgRole.Owner);
  });

  it('refuses a Viewer trying to manage members — the request the F9 UI hides', async () => {
    const guard = build(VIEWER, { [ORG_PERMISSION_KEY]: { permission: 'members:manage', orgIdParam: 'orgId' } });
    const { ctx } = contextFor(VIEWER.email, { orgId: 'org-a' });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still lets a Viewer read the member list — otherwise names fall back to raw emails', async () => {
    const guard = build(VIEWER, { [ORG_PERMISSION_KEY]: { permission: 'members:read', orgIdParam: 'orgId' } });
    const { ctx } = contextFor(VIEWER.email, { orgId: 'org-a' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('resolves the role in the organization named by the route, not the one in x-org-id', async () => {
    // Owner of org-z asking about org-a: being an Owner *somewhere* must grant nothing here.
    const guard = build(OUTSIDER, { [ORG_PERMISSION_KEY]: { permission: 'members:read', orgIdParam: 'orgId' } });
    const { ctx } = contextFor(OUTSIDER.email, { orgId: 'org-a' }, { 'x-org-id': 'org-z' });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('grants nothing when the caller has no membership at all', async () => {
    const guard = build({ ...OUTSIDER, organizations: [] }, { [ORG_PERMISSION_KEY]: { permission: 'members:read', orgIdParam: 'orgId' } });
    const { ctx } = contextFor(OUTSIDER.email, { orgId: 'org-a' });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('treats the personal space as Owner — there is no membership row for it', async () => {
    const guard = build(OWNER, { [ORG_PERMISSION_KEY]: { permission: 'org:settings', orgIdParam: 'orgId' } });
    const { request, ctx } = contextFor(OWNER.email, { orgId: 'user-owner' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.ctx.isPersonalSpace).toBe(true);
  });

  it('lets a platform admin through as an explicit bypass', async () => {
    const guard = build(OUTSIDER, { [ORG_PERMISSION_KEY]: { permission: 'members:manage', orgIdParam: 'orgId' } });
    const { ctx } = contextFor(OUTSIDER.email, { orgId: 'org-a' }, {}, { roles: { admin: null } });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('enforces a minimum role when the rule is a role instead of a permission', async () => {
    const viewerGuard = build(VIEWER, { [ORG_ROLE_KEY]: { role: OrgRole.Admin, orgIdParam: 'orgId' } });
    await expect(viewerGuard.canActivate(contextFor(VIEWER.email, { orgId: 'org-a' }).ctx)).rejects.toBeInstanceOf(ForbiddenException);

    const ownerGuard = build(OWNER, { [ORG_ROLE_KEY]: { role: OrgRole.Admin, orgIdParam: 'orgId' } });
    await expect(ownerGuard.canActivate(contextFor(OWNER.email, { orgId: 'org-a' }).ctx)).resolves.toBe(true);
  });

  it('populates req.ctx and allows the request when the route carries no rule (F12 closes this)', async () => {
    const guard = build(VIEWER, {});
    const { request, ctx } = contextFor(VIEWER.email, {}, { 'x-org-id': 'org-a' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.ctx.role).toBe(OrgRole.Viewer);
    expect(request.ctx.permissions).toContain('members:read');
  });

  it('skips everything on a @Public() route', async () => {
    const guard = build(null, { [IS_PUBLIC_KEY]: true, [ORG_PERMISSION_KEY]: { permission: 'members:manage' } });
    const { ctx } = contextFor('nobody@cm.com');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
