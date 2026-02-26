import { IAuditable } from '@dataclouder/nest-core';

export interface ISocialMediaTracker {
  _id?: string;
  id?: string;
  name?: string;
  description?: string;
  asset?: any;
  auditable?: IAuditable;
}
