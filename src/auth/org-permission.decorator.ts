import { SetMetadata } from '@nestjs/common';
import { OrgRole } from 'src/user/user.class';

export const ORG_PERMISSION_KEY = 'cm:orgPermission';
export const ORG_ROLE_KEY = 'cm:orgRole';
export const ORG_ID_SOURCE_KEY = 'cm:orgIdSource';

export interface IOrgAuthOptions {
  /**
   * Route parameter naming the organization the request acts on (`:orgId`, `:id`, …).
   *
   * When set, the role is resolved **in that organization**, not in whatever `x-org-id` says. This
   * is what makes "having `members:read` in *some* organization" insufficient, which is the whole
   * point of the check.
   */
  orgIdParam?: string;
}

/**
 * Requires an organization permission from `ORG_PERMISSIONS` to reach the route.
 *
 * ```ts
 * @OrgPermission('members:manage', { orgIdParam: 'orgId' })
 * ```
 *
 * Needs `OrgContextGuard` on the controller (or globally, from F12 on).
 */
export const OrgPermission = (permission: string, options: IOrgAuthOptions = {}) =>
  SetMetadata(ORG_PERMISSION_KEY, { permission, ...options });

/**
 * Requires a minimum organization role. Use it only for actions no permission in the matrix
 * describes — deleting the organization, for instance. Everything else goes through `@OrgPermission`,
 * because the matrix is the place where policy is supposed to live.
 */
export const RequireOrgRole = (role: OrgRole, options: IOrgAuthOptions = {}) => SetMetadata(ORG_ROLE_KEY, { role, ...options });
