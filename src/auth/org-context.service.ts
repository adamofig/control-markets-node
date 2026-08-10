import { Injectable } from '@nestjs/common';
import { AppToken } from '@dataclouder/nest-auth';
import { AppUserService } from 'src/user/user.service';
import { IUserOrganization, OrgRole, resolveOrgRole } from 'src/user/user.class';
import { isPlatformAdmin, permissionsForRole } from './org-permissions';

/**
 * The caller's resolved position inside one organization, attached to the request as `req.ctx`.
 *
 * It is deliberately smaller than `IAuthContext` (the frontend contract): authorization needs the
 * role and the permissions, not display data like the organization name.
 */
export interface IRequestOrgContext {
  userId: string | null;
  email: string;
  orgId: string | null;
  role: OrgRole | null;
  permissions: string[];
  isPlatformAdmin: boolean;
  /** True for the user's personal space, where they are always Owner and there is no membership row. */
  isPersonalSpace: boolean;
}

/**
 * Resolves "who is this, in which organization, with what role" — **against Mongo, on every
 * request**, never from the JWT.
 *
 * The token refreshes about once an hour, so a role kept inside it would let a revoked Admin keep
 * their powers for up to sixty minutes. Reading the membership costs one indexed lookup (the
 * `email` index added in F1) and makes a role change effective on the very next request.
 *
 * Both callers go through here on purpose: `GET /api/auth/context`, which tells the frontend what
 * to render, and `OrgContextGuard`, which decides what the server accepts. If those two ever
 * disagree the UI shows buttons that 403 — so they share one resolver instead of two copies.
 */
@Injectable()
export class OrgContextService {
  constructor(private readonly userService: AppUserService) {}

  async resolve(token: AppToken, requestedOrgId?: string | null): Promise<IRequestOrgContext> {
    const platformAdmin = isPlatformAdmin(token);
    const user = token?.email ? await this.userService.findUserByEmail(token.email) : null;

    if (!user) {
      // Authenticated but with no account row yet (pre `/api/init/user`). No membership, no permissions.
      return {
        userId: null,
        email: token?.email,
        orgId: requestedOrgId ?? null,
        role: null,
        permissions: [],
        isPlatformAdmin: platformAdmin,
        isPersonalSpace: false,
      };
    }

    const orgId = requestedOrgId || user.defaultOrgId || null;
    const membership: IUserOrganization | undefined = user.organizations?.find((org: IUserOrganization) => org.orgId === orgId);

    // The personal space is built client-side as `{ orgId: user.id }` and has no membership row;
    // without this branch a user would be a Viewer in their own space.
    const isPersonalSpace = !!orgId && (orgId === user._id?.toString() || orgId === user.id);
    const role: OrgRole | null = isPersonalSpace ? OrgRole.Owner : resolveOrgRole(membership);

    return {
      userId: user.id || user._id?.toString() || null,
      email: user.email,
      orgId,
      role,
      permissions: permissionsForRole(role),
      isPlatformAdmin: platformAdmin,
      isPersonalSpace,
    };
  }
}
