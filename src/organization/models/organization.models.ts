import { IAuditable } from '@dataclouder/nest-core';

export interface IOrganization {
  _id?: string;
  id?: string;
  name?: string;
  image?: any;
  description?: string;
  type?: string;
  guests?: any[];
  socialNetworks?: { type: string, account: string }[];
}
