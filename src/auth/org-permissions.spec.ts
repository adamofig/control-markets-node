import { OrgRole } from 'src/user/user.class';
import { hasOrgPermission, ORG_ROLE_RANK, permissionsForRole } from './org-permissions';

describe('ORG_PERMISSIONS matrix', () => {
  it('gives the owner everything', () => {
    expect(permissionsForRole(OrgRole.Owner)).toEqual(['*']);
    expect(hasOrgPermission(OrgRole.Owner, 'anything:at-all')).toBe(true);
  });

  it('fails closed when there is no membership', () => {
    expect(permissionsForRole(null)).toEqual([]);
    expect(hasOrgPermission(null, 'tasks:read')).toBe(false);
    expect(hasOrgPermission(undefined, 'members:read')).toBe(false);
  });

  it('lets every role resolve member names — otherwise the UI falls back to raw emails', () => {
    for (const role of [OrgRole.Admin, OrgRole.Member, OrgRole.Viewer]) {
      expect(hasOrgPermission(role, 'members:read')).toBe(true);
    }
  });

  it('gives an admin at least everything a member has', () => {
    for (const permission of permissionsForRole(OrgRole.Member)) {
      expect(hasOrgPermission(OrgRole.Admin, permission)).toBe(true);
    }
  });

  it('keeps a viewer read-only', () => {
    const viewer = permissionsForRole(OrgRole.Viewer);
    expect(viewer.filter(p => p.endsWith(':write') || p === 'members:manage' || p === 'org:settings')).toEqual([]);
  });

  it('covers the scopes the frontend needs to gate every section', () => {
    for (const permission of ['content:write', 'credentials:write', 'tasks:write', 'org:settings']) {
      expect(hasOrgPermission(OrgRole.Admin, permission)).toBe(true);
    }
  });

  it('orders roles owner > admin > member > viewer', () => {
    expect(ORG_ROLE_RANK[OrgRole.Owner]).toBeGreaterThan(ORG_ROLE_RANK[OrgRole.Admin]);
    expect(ORG_ROLE_RANK[OrgRole.Admin]).toBeGreaterThan(ORG_ROLE_RANK[OrgRole.Member]);
    expect(ORG_ROLE_RANK[OrgRole.Member]).toBeGreaterThan(ORG_ROLE_RANK[OrgRole.Viewer]);
  });
});

// The platform-role claim contract is covered in `platform-roles.spec.ts`.
