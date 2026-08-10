import { Controller, Get, Req, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AllExceptionsHandler, AppGuard } from '@dataclouder/nest-core';
import { AppToken } from '@dataclouder/nest-auth';
import { DecodedToken } from 'src/common/token.decorator';
import { OrgId } from 'src/common/org-id.decorator';
import { ProjectAuthGuard } from 'src/user/project-auth.guard';
import { AppUserService } from 'src/user/user.service';
import { OrganizationService } from 'src/organization/services/organization.service';
import { IUserOrganization } from 'src/user/user.class';
import { AuthMethod, IAuthContext } from './auth-context.models';
import { OrgContextService } from './org-context.service';

/**
 * The single place the frontend asks "what can this user do here?".
 *
 * It runs on a LOCAL guard on purpose: the permission context does not depend on the global guard,
 * which lands in F12. The contract returned here does not change when that happens — it only
 * becomes validated.
 */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/auth')
@UseFilters(AllExceptionsHandler)
export class AuthContextController {
  constructor(
    private readonly userService: AppUserService,
    private readonly organizationService: OrganizationService,
    private readonly orgContext: OrgContextService
  ) {}

  /**
   * F11: the role and permissions come from `OrgContextService`, the very same resolver
   * `OrgContextGuard` uses to decide what the server accepts. Two copies of this logic would mean a
   * UI that renders buttons the API then rejects — the resolver is shared so they cannot drift.
   *
   * Only the display fields (`orgName`) are resolved here: the guard has no use for them.
   */
  @Get('context')
  async getContext(@DecodedToken() token: AppToken, @OrgId() headerOrgId: string, @Req() request: any): Promise<IAuthContext> {
    // TODO(F12): the requested orgId is trusted here. The global guard validates it against the
    // caller's membership; until then a client can name any org and the role simply resolves to null.
    const ctx = await this.orgContext.resolve(token, headerOrgId);
    const membership: IUserOrganization | undefined = ctx.orgId ? await this.findMembership(token, ctx.orgId) : undefined;

    return {
      userId: ctx.userId,
      email: ctx.email,
      orgId: ctx.orgId,
      orgName: membership?.name ?? (ctx.orgId ? await this.resolveOrgName(ctx.orgId) : null),
      role: ctx.role,
      permissions: ctx.permissions,
      isPlatformAdmin: ctx.isPlatformAdmin,
      authMethod: this.authMethodOf(request),
    };
  }

  /** Only for the organization name shown in the UI — authorization never depends on this. */
  private async findMembership(token: AppToken, orgId: string): Promise<IUserOrganization | undefined> {
    const user = token?.email ? await this.userService.findUserByEmail(token.email) : null;
    return user?.organizations?.find((org: IUserOrganization) => org.orgId === orgId);
  }

  private async resolveOrgName(orgId: string): Promise<string | null> {
    const org = await this.organizationService.findOne(orgId, { name: 1 }).catch(() => null);
    return org?.name ?? null;
  }

  /** Set by `ProjectAuthGuard`, which is the only place that knows which branch authenticated. */
  private authMethodOf(request: any): AuthMethod {
    return (request?.authMethod as AuthMethod) ?? 'firebase';
  }
}
