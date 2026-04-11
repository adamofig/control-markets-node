import { IAuditable } from '@dataclouder/nest-core';

export enum HRStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ON_LEAVE = 'on-leave',
  TERMINATED = 'terminated',
}

export enum HRContractType {
  EMPLOYEE = 'employee',
  CONTRACTOR = 'contractor',
  FREELANCER = 'freelancer',
  PART_TIME = 'part-time',
}

export enum PaymentType {
  RECURRING = 'recurring',
  ONE_TIME = 'one-time',
}

export enum PaymentFrequency {
  WEEKLY = 'weekly',
  BI_WEEKLY = 'bi-weekly',
  MONTHLY = 'monthly',
}

export enum PaymentCurrency {
  USD = 'USD',
  EUR = 'EUR',
  MXN = 'MXN',
}

export interface IPaymentConfig {
  type: PaymentType;
  amount?: number;
  currency?: PaymentCurrency;
  frequency?: PaymentFrequency;
  nextPaymentDate?: Date;
  notes?: string;
}

export interface IHumanResource {
  _id?: string;
  id?: string;
  orgId?: string;
  userId: string;

  name?: string;
  role?: string;
  description?: string;
  status?: HRStatus;
  contractType?: HRContractType;
  skills?: string[];

  payment?: IPaymentConfig;

  startDate?: Date;
  endDate?: Date;

  auditable?: IAuditable;
  createdAt?: Date;
  updatedAt?: Date;
}
