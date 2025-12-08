export type PermissionClaim = Record<PermissionType, { exp: Date; num: number }>;

export type SubscriptionClaim = { type: PlanType; exp?: Date };

export type RolClaim = Record<RolType, any>;

export interface AppAuthClaims {
  plan: SubscriptionClaim;
  permissions: PermissionClaim;
  roles?: RolClaim;
}

export enum PlanType {
  Basic = 'basic',
  // Standard = 'standard',
  Follower = 'follower',
  Premium = 'premium',
  Beta = 'beta',
}

export const PlanLevel = {
  [PlanType.Basic]: { level: 1 },
  [PlanType.Follower]: { level: 2 },
  [PlanType.Beta]: { level: 3 },
  [PlanType.Premium]: { level: 4 },
};

export enum PermissionType {
  Vocabulary = 'vocabulary',
  LearningExampleRequest = 'leRequest',
  Conversation = 'conversation',
}

export enum RolType {
  Admin = 'admin',
  Teacher = 'teacher',
  Tester = 'tester',
}

export const RolOptions = [
  { name: 'Administrador', value: RolType.Admin },
  { name: 'Profesor', value: RolType.Teacher },
  { name: 'Tester', value: RolType.Tester },
];
