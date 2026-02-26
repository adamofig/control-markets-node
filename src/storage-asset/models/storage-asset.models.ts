import { IAuditable } from '@dataclouder/nest-core';
import { CloudFileStorage } from '@dataclouder/nest-storage';

export interface IStorageAsset {
  _id?: string;
  id?: string;
  name?: string;
  description?: string;
  storage?: CloudFileStorage;
  auditable?: IAuditable;
}
