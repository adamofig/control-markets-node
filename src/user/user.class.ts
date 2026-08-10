import { AppAuthClaims } from '@dataclouder/nest-auth';

export class PersonalData {
  firstname: string;
  lastname: string;
  nickname: string;
  gender: string;
  birthday: Date;
}

/** The four org-scoped roles. Platform access lives in `user.claims` and is a separate axis. */
export enum OrgRole {
  Owner = 'owner',
  Admin = 'admin',
  Member = 'member',
  Viewer = 'viewer',
}

export type OrgMembershipStatus = 'active' | 'invited' | 'disabled';

/** Mirrors `FileStorageData` from `@dataclouder/ngx-cloud-storage`; the backend stores it opaquely. */
export type StoredImage = Record<string, any>;

/**
 * A user's membership in an organization. This is the single source of truth for who belongs
 * where and with which role — the organization document does not store permissions.
 */
export interface IUserOrganization {
  orgId: string;
  /** Name of the ORGANIZATION (not of the member). */
  name: string;

  /** Optional until the F2 migration backfills every document. Read default is `OrgRole.Member`. */
  role?: OrgRole;
  status?: OrgMembershipStatus;
  joinedAt?: Date;

  /** Per-organization override of the member's display name. Migrated from `organizations.guests[].name`. */
  displayName?: string;
  /** Per-organization override of the member's avatar. Migrated from `organizations.guests[].image`. */
  avatar?: StoredImage;

  /** @deprecated Removed in F16. Dual-written alongside `role` during the transition. */
  roles?: string[];
}

/** Role of a membership that predates the F2 migration. */
export function resolveOrgRole(membership: Pick<IUserOrganization, 'role'> | null | undefined): OrgRole | null {
  if (!membership) {
    return null;
  }
  return membership.role ?? OrgRole.Member;
}

export interface IUser {
  _id?: any;
  id?: string;
  fbId?: string;
  urlPicture: string;
  email: string;
  personalData: Partial<PersonalData>;
  claims: AppAuthClaims;
  authStrategy: string;
  settings: UserSettings;
  // Properties for control Markets
  // userOrgId?: string; // Default organization created When user logs in for the first time.
  defaultOrgId: string; // Temporal solution so save current organization user is working.
  organizations: IUserOrganization[];
}

export interface IConversationSettings {
  realTime: boolean;
  repeatRecording: boolean;
  fixGrammar: boolean;
  superHearing: boolean;
  voice: string;
  autoTranslate: boolean;
  highlightWords: boolean;
  modelName: string;
  provider: string;
  speed: string;
  speedRate: number; // Temporal only 0 to 100.
}

export class UserSettings {
  baseLanguage: string;
  targetLanguage: string;
  enableNotifications: boolean;
  wordsNumber: number;
  conversation: IConversationSettings;
}
