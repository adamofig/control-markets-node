import { OrgRole } from 'src/user/user.class';

export type AuthMethod = 'firebase' | 'pat' | 'master' | 'system';

/**
 * What `GET /api/auth/context` returns: the caller's resolved organization context.
 *
 * The frontend does not replicate `ORG_PERMISSIONS` — it reads `permissions` from here. That keeps
 * the matrix in one versioned place and means a role change takes effect on the next request
 * instead of on the next token refresh.
 */
export interface IAuthContext {
  userId: string;
  email: string;
  orgId: string | null;
  orgName: string | null;
  /** `null` when the caller has no membership in `orgId`. Consumers must fail closed on null. */
  role: OrgRole | null;
  /** Expanded from `ORG_PERMISSIONS`; owner is `['*']`. Empty when `role` is null. */
  permissions: string[];
  /** Platform access from `user.claims` — an explicit bypass, never an organization role. */
  isPlatformAdmin: boolean;
  authMethod: AuthMethod;
}
