import { IAuditable } from '@dataclouder/nest-core';

export interface IOrganization {
  _id?: string;
  id?: string;
  name?: string;
  description?: string;
  type?: string;
  guests?: any[];
}
