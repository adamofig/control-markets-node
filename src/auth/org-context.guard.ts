import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from 'src/user/user.class';
import { hasOrgPermission, ORG_ROLE_RANK } from './org-permissions';
import { IS_PUBLIC_KEY } from './public.decorator';
import { IOrgAuthOptions, ORG_PERMISSION_KEY, ORG_ROLE_KEY } from './org-permission.decorator';
import { IRequestOrgContext, OrgContextService } from './org-context.service';

/**
 * F11 — authorization. Resolves `req.ctx` and enforces `@OrgPermission` / `@RequireOrgRole`.
 *
 * It runs **after** `ProjectAuthGuard` (which answers "who are you"); this one answers "may you do
 * this, here". A route with no decorator only gets its `req.ctx` populated — this guard never
 * blocks by itself, because a default-closed guard is F12's job and doing it here would take down
 * every route in the same commit.
 *
 * F12 registers this exact class as `APP_GUARD`. Nothing in it changes then, only where it is
 * registered — which is why it reads `@Public()` already.
 *
 * ## Which organization is being checked
 *
 * The plan (doc 06 §F11) said to compare the route's `:orgId` against `req.ctx.orgId`, the one the
 * `x-org-id` header selected. This implementation resolves the role **in the organization the route
 * names** instead. Same security property — a Member of org A gets 403 on org B, because their
 * membership in B is what is read — but it does not break the two screens that legitimately act on
 * a non-active organization: `/page/admin/organizations/edit/:id`, and editing an organization from
 * the list while another one is active. Comparing against the header would 403 both.
 *
 * When the two disagree the request is still served (by the route's own organization) and the
 * mismatch is logged, so F12 lands with evidence instead of assumptions.
 */
@Injectable()
export class OrgContextGuard implements CanActivate {
  private readonly logger = new Logger('OrgContextGuard');

  constructor(
    private readonly reflector: Reflector,
    private readonly orgContext: OrgContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const permissionRule = this.reflector.getAllAndOverride<{ permission: string } & IOrgAuthOptions>(ORG_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const roleRule = this.reflector.getAllAndOverride<{ role: OrgRole } & IOrgAuthOptions>(ORG_ROLE_KEY, [context.getHandler(), context.getClass()]);
    const rule = permissionRule ?? roleRule;

    const headerOrgId = (request.headers?.['x-org-id'] as string)?.trim() || request.orgId || null;
    const routeOrgId = rule?.orgIdParam ? request.params?.[rule.orgIdParam] : null;

    if (routeOrgId && headerOrgId && routeOrgId !== headerOrgId) {
      this.logger.log(`[ORG_SCOPE_MISMATCH] ${request.method} ${request.url} | route=${routeOrgId} | header=${headerOrgId} | actor=${request.decodedToken?.email ?? '-'}`);
    }

    const ctx: IRequestOrgContext = await this.orgContext.resolve(request.decodedToken, routeOrgId || headerOrgId);
    request.ctx = ctx;

    if (!rule) {
      // No decorator: context only. Default-closed arrives in F12, deliberately not here.
      return true;
    }

    if (ctx.isPlatformAdmin) {
      // Platform access is an explicit bypass and must never be silent — same rule as [ADMIN_BYPASS].
      this.logger.warn(`[ADMIN_BYPASS] ${request.method} ${request.url} | actor=${ctx.email} | orgId=${ctx.orgId ?? '-'}`);
      return true;
    }

    if (permissionRule) {
      if (!hasOrgPermission(ctx.role, permissionRule.permission)) {
        throw new ForbiddenException(this.denyMessage(ctx, `the '${permissionRule.permission}' permission`));
      }
      return true;
    }

    if (ORG_ROLE_RANK[ctx.role as OrgRole] === undefined || ORG_ROLE_RANK[ctx.role as OrgRole] < ORG_ROLE_RANK[roleRule.role]) {
      throw new ForbiddenException(this.denyMessage(ctx, `the '${roleRule.role}' role or above`));
    }
    return true;
  }

  /**
   * The message says which organization was evaluated. Without it, "you need members:manage" is
   * indistinguishable between "your role is too low" and "you are not a member of this org at all",
   * and those need different fixes from whoever hits it.
   */
  private denyMessage(ctx: IRequestOrgContext, requirement: string): string {
    const role = ctx.role ?? 'none (not a member)';
    return `This action requires ${requirement} in organization ${ctx.orgId ?? '-'}. Your role there is: ${role}.`;
  }
}
