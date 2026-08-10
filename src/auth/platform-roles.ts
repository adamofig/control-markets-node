import { RolType } from '@dataclouder/nest-auth';

/**
 * Platform-level roles, read from `user.claims.roles`. This is NOT an organization role — it is the
 * support/global-admin axis, and it stays a separate concept from `users.organizations[].role`.
 *
 * ## How a role grant is encoded
 *
 * `RolClaim` is `Record<RolType, null | string | Date>`, and the meaning lives in the KEY, not in
 * the value:
 *
 * | Claim                       | Meaning                        |
 * |-----------------------------|--------------------------------|
 * | key absent                  | does not hold the role         |
 * | `{ admin: null }`           | holds it, never expires        |
 * | `{ admin: '2027-01-01' }`   | holds it until that date       |
 *
 * The admin claims editor writes exactly this — it renders "No Expira" when the value is empty and
 * the date otherwise — and `@dataclouder/ngx-users.hasRole()` reads it exactly this way on the
 * frontend. This function is the backend mirror of that, so both ends agree.
 *
 * ## Why not `token?.roles?.admin`
 *
 * That truthiness test, used elsewhere in this repo, is inverted in BOTH directions: it reads the
 * permanent grant (`null`) as "not an admin", and an EXPIRED grant (a past date, still truthy) as
 * a valid one. Presence plus expiry is the only correct test.
 */
export function hasPlatformRole(token: any, rol: RolType): boolean {
  const roles = token?.roles ?? token?.claims?.roles;
  if (!roles || !(rol in roles)) {
    return false;
  }
  const expiry = roles[rol];
  if (expiry === null || expiry === undefined) {
    return true;
  }
  const expiresAt = new Date(expiry).getTime();
  // An unparseable value is treated as no grant: a malformed claim must not become a permanent one.
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

/** Platform access (support, global admin) — an explicit, audited bypass, never an organization role. */
export function isPlatformAdmin(token: any): boolean {
  return hasPlatformRole(token, RolType.Admin);
}
