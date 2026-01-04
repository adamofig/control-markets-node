import { CloudFileStorage } from '@dataclouder/nest-storage';

export interface IAssetNodeData {
  _id?: string;
  id: string;
  name: string;
  type: string;
  storage: CloudFileStorage;
}
