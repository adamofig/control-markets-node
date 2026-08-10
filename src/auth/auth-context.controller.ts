import { Controller, Get, Req, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AllExceptionsHandler, AppGuard } from '@dataclouder/nest-core';
import { AppToken } from '@dataclouder/nest-auth';
import { DecodedToken } from 'src/common/token.decorator';
import { OrgId } from 'src/common/org-id.decorator';
import { ProjectAuthGuard } from 'src/user/project-auth.guard';
import { AppUserService } from 'src/user/user.service';
import { OrganizationService } from 'src/organization/services/organization.service';
import { IUserOrganization, OrgRole, resolveOrgRole } from 'src/user/user.class';
import { isPlatformAdmin, permissionsForRole } from './org-permissions';
import { AuthMethod, IAuthContext } from './auth-context.models';

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
    private readonly organizationService: OrganizationService
  ) {}

  @Get('context')
  async getContext(@DecodedToken() token: AppToken, @OrgId() headerOrgId: string, @Req() request: any): Promise<IAuthContext> {
    const user = await this.userService.findUserByEmail(token.email);

    if (!user) {
      // Authenticated against Firebase but with no account row yet (pre-`/api/init/user`).
      return {
        userId: null,
        email: token.email,
        orgId: null,
        orgName: null,
        role: null,
        permissions: [],
        isPlatformAdmin: isPlatformAdmin(token),
        authMethod: this.authMethodOf(request),
      };
    }

    // TODO(F12): the requested orgId is trusted here. The global guard validates it against the
    // caller's membership; until then a client can name any org and the role simply resolves to null.
    const orgId = headerOrgId || user.defaultOrgId || null;
    const membership: IUserOrganization | undefined = user.organizations?.find((org: IUserOrganization) => org.orgId === orgId);

    // The personal space is built client-side as `{ orgId: user.id }` and has no membership row;
    // without this branch a user would be a Viewer in their own space.
    const isPersonalSpace = !!orgId && (orgId === user._id?.toString() || orgId === user.id);
    const role: OrgRole | null = isPersonalSpace ? OrgRole.Owner : resolveOrgRole(membership);

    return {
      userId: user.id || user._id?.toString(),
      email: user.email,
      orgId,
      orgName: membership?.name ?? (orgId ? await this.resolveOrgName(orgId) : null),
      role,
      permissions: permissionsForRole(role),
      isPlatformAdmin: isPlatformAdmin(token),
      authMethod: this.authMethodOf(request),
    };
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
