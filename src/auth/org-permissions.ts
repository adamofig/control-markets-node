import { OrgRole } from 'src/user/user.class';

/**
 * Role → permission matrix. Lives in code, not in the database: it is product policy, not tenant data.
 * An organization never stores permissions — membership in `users.organizations[].role` is the only input.
 */
export const ORG_PERMISSIONS: Record<OrgRole, readonly string[]> = {
  [OrgRole.Owner]: ['*'],
  [OrgRole.Admin]: [
    'members:manage',
    'members:read',
    'org:settings',
    'flows:write',
    'agents:write',
    'storage:write',
    'tasks:write',
    'content:write',
    'credentials:write',
    'billing:read',
  ],
  [OrgRole.Member]: ['members:read', 'flows:write', 'agents:write', 'storage:write', 'tasks:write', 'content:write'],
  [OrgRole.Viewer]: ['members:read', 'flows:read', 'agents:read', 'storage:read', 'tasks:read', 'content:read'],
} as const;

/**
 * Ordering used by the "nobody grants a role above their own" invariant.
 * It is not a permission check — authorization goes through the matrix above.
 */
export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  [OrgRole.Viewer]: 0,
  [OrgRole.Member]: 1,
  [OrgRole.Admin]: 2,
  [OrgRole.Owner]: 3,
};

/** No membership → no permissions. The contract fails closed at every layer that reads it. */
export function permissionsForRole(role: OrgRole | null | undefined): string[] {
  if (!role) {
    return [];
  }
  return [...(ORG_PERMISSIONS[role] ?? [])];
}

export function hasOrgPermission(role: OrgRole | null | undefined, permission: string): boolean {
  const granted = permissionsForRole(role);
  return granted.includes('*') || granted.includes(permission);
}

// Platform access lives on its own axis — see `platform-roles.ts`. Re-exported so callers that
// reason about authorization have a single import.
export { hasPlatformRole, isPlatformAdmin } from './platform-roles';
