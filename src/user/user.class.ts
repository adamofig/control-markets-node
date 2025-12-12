import { AppAuthClaims } from '@dataclouder/nest-auth';

export class PersonalData {
  firstname: string;
  lastname: string;
  nickname: string;
  gender: string;
  birthday: Date;
}

export interface IUserOrganization {
  orgId: string;
  name: string;
  roles: string[]; // For Future use, user may have specific roles in the organization.
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
