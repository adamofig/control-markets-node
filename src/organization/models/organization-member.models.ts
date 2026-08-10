import { OrgMembershipStatus, OrgRole, StoredImage } from 'src/user/user.class';

/**
 * What `GET /api/organization/:orgId/members` returns — a projection, never the user document.
 * `fullName` is derived: the user schema has no `name` field, only `personalData`.
 */
export interface IOrgMemberView {
  userId: string;
  email: string;
  fullName: string;
  /** Per-organization override of the name. */
  displayName?: string;
  /** Per-organization override of the avatar. */
  avatar?: StoredImage;
  /** Firebase picture, used as fallback when there is no override. */
  urlPicture?: string;
  role: OrgRole;
  status: OrgMembershipStatus;
  joinedAt?: Date;
  isYou: boolean;
}

export type OrgUserOperation = 'add' | 'remove' | 'update-role' | 'update-profile';

export class OrgUserOperationDto {
  email: string;
  operation: OrgUserOperation;
  /** add / update-role */
  role?: OrgRole;
  /** update-profile */
  displayName?: string;
  /** update-profile */
  avatar?: StoredImage;
}

/**
 * Who is asking. Business invariants need the caller's own role, which is resolved from their
 * membership — not from a guard, so the rules also cover the MCP tools that enter another way.
 */
export interface IOrgOperationRequester {
  email?: string;
  /** `user.claims` grants platform access; it bypasses the role hierarchy, never the last-owner rule. */
  isPlatformAdmin: boolean;
}
