import { UnauthorizedException } from '@nestjs/common';
import { ProjectAuthGuard } from './project-auth.guard';
import { SYSTEM_PRINCIPAL_EMAIL, SYSTEM_PRINCIPAL_ID, SystemMasterTokenService } from './system-master-token.service';
import { IS_PUBLIC_KEY } from 'src/auth/public.decorator';

describe('ProjectAuthGuard — system master token', () => {
  const MASTER = `cm_master_${'a'.repeat(48)}`;

  const owner = {
    _id: { toString: () => 'mongo-1' },
    id: 'user-1',
    fbId: 'firebase-1',
    email: 'adamo@example.com',
    defaultOrgId: 'org-personal',
    personalData: { firstname: 'Adamo' },
    claims: { roles: {}, plan: { type: 'basic' } },
  };

  function createGuard(env: Record<string, string | undefined>, foundUser: any = owner) {
    // process.env coerces values to strings, so an `undefined` entry must delete the key instead.
    const previous: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(env)) {
      previous[key] = process.env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const masterToken = new SystemMasterTokenService();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    const userModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(foundUser) }),
      }),
    };
    const guard = new ProjectAuthGuard({} as any, userModel as any, masterToken);
    return { guard, userModel };
  }

  function contextFor(headers: Record<string, string>) {
    const request: any = { headers, method: 'POST', url: '/api/agent-tasks/operation' };
    return { request, ctx: { switchToHttp: () => ({ getRequest: () => request }) } as any };
  }

  it('authenticates as the configured default user and adopts x-org-id', async () => {
    const { guard, userModel } = createGuard({ SYSTEM_MASTER_TOKEN: MASTER, SYSTEM_MASTER_USER: owner.email });
    const { request, ctx } = contextFor({ authorization: `Bearer ${MASTER}`, 'x-org-id': 'org-polilan' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(userModel.findOne).toHaveBeenCalledWith({ email: owner.email });
    expect(request.decodedToken.email).toBe(owner.email);
    expect(request.decodedToken.isMaster).toBe(true);
    expect(request.decodedToken.roles.admin).toBeNull();
    expect(request.orgId).toBe('org-polilan');
  });

  it('authenticates via CONTROL_MASTER_TOKEN as canonical variable', async () => {
    const { guard, userModel } = createGuard({ CONTROL_MASTER_TOKEN: MASTER, SYSTEM_MASTER_USER: owner.email });
    const { request, ctx } = contextFor({ authorization: `Bearer ${MASTER}`, 'x-org-id': 'org-polilan' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(userModel.findOne).toHaveBeenCalledWith({ email: owner.email });
    expect(request.decodedToken.email).toBe(owner.email);
    expect(request.decodedToken.isMaster).toBe(true);
    expect(request.orgId).toBe('org-polilan');
  });

  it('falls back to the user default org when no x-org-id is sent', async () => {
    const { guard } = createGuard({ SYSTEM_MASTER_TOKEN: MASTER, SYSTEM_MASTER_USER: owner.email });
    const { request, ctx } = contextFor({ 'x-api-key': MASTER });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.orgId).toBe('org-personal');
  });

  it('lets x-system-user override the default identity', async () => {
    const { guard, userModel } = createGuard({ SYSTEM_MASTER_TOKEN: MASTER, SYSTEM_MASTER_USER: owner.email });
    const { ctx } = contextFor({ authorization: `Bearer ${MASTER}`, 'x-system-user': 'Other@Example.com' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(userModel.findOne).toHaveBeenCalledWith({ email: 'other@example.com' });
  });

  it('rejects the request when the impersonated identity does not exist', async () => {
    const { guard } = createGuard({ SYSTEM_MASTER_TOKEN: MASTER, SYSTEM_MASTER_USER: 'ghost@example.com' }, null);
    const { ctx } = contextFor({ authorization: `Bearer ${MASTER}` });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses the synthetic system principal when no identity is configured', async () => {
    const { guard } = createGuard({ SYSTEM_MASTER_TOKEN: MASTER, SYSTEM_MASTER_USER: undefined });
    const { request, ctx } = contextFor({ authorization: `Bearer ${MASTER}`, 'x-org-id': 'org-polilan' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.decodedToken.uid).toBe(SYSTEM_PRINCIPAL_ID);
    expect(request.decodedToken.email).toBe(SYSTEM_PRINCIPAL_EMAIL);
    expect(request.orgId).toBe('org-polilan');
  });

  it('accepts any token from the rotation list', async () => {
    const next = `cm_master_${'b'.repeat(48)}`;
    const { guard } = createGuard({ SYSTEM_MASTER_TOKEN: `${MASTER},${next}`, SYSTEM_MASTER_USER: owner.email });
    const { ctx } = contextFor({ authorization: `Bearer ${next}` });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('ignores master tokens that are too short to be safe', () => {
    const { guard } = createGuard({ SYSTEM_MASTER_TOKEN: 'cm_master_short', SYSTEM_MASTER_USER: owner.email });
    const { ctx } = contextFor({ authorization: 'Bearer cm_master_short' });

    // Not a master token and not a PAT, so it falls through to the Firebase branch and blows up there.
    return expect(guard.canActivate(ctx)).rejects.toBeDefined();
  });

  it('does not intercept anything when the feature is disabled', async () => {
    const { guard } = createGuard({ SYSTEM_MASTER_TOKEN: undefined, SYSTEM_MASTER_USER: undefined });
    const { ctx } = contextFor({});

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('ProjectAuthGuard — @Public() routes (F10)', () => {
  const userModel = { findOne: jest.fn() };

  function contextFor(headers: Record<string, string> = {}) {
    const request: any = { headers, method: 'GET', url: '/api/creative-flowboard/subscribe/flow-1' };
    return {
      request,
      ctx: {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => function handler() {},
        getClass: () => class SomeController {},
      } as any,
    };
  }

  function guardWith(isPublic: boolean | undefined) {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(isPublic) } as any;
    const masterToken = new SystemMasterTokenService();
    return { guard: new ProjectAuthGuard({} as any, userModel as any, masterToken, reflector), reflector };
  }

  it('lets a public route through with no credentials at all', async () => {
    const { guard, reflector } = guardWith(true);
    const { ctx } = contextFor();

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, expect.any(Array));
    // The point of short-circuiting first: a public route must not pay for a database lookup either.
    expect(userModel.findOne).not.toHaveBeenCalled();
  });

  it('still rejects an unauthenticated request when the route is not public', async () => {
    const { guard } = guardWith(false);
    const { ctx } = contextFor();

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails closed when no reflector was injected — nothing is public by accident', async () => {
    const masterToken = new SystemMasterTokenService();
    const guard = new ProjectAuthGuard({} as any, userModel as any, masterToken);
    const { ctx } = contextFor();

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
