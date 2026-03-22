import { IAuditable } from '@dataclouder/nest-core';

export enum InspirationType {
  ACCOUNT = 'account',
  RESOURCE = 'resource',
  CONTENT = 'content',
  IDEA = 'idea',
}

export interface IInspirationMonitoring {
  isEnabled: boolean;
  frequency: 'daily' | 'weekly' | 'manual';
  lastCheckAt?: Date;
  nextCheckAt?: Date;
  activeScraperId?: string;
}

export interface IInspirationSource {
  _id?: string;
  id?: string;
  orgId?: string;
  title?: string;
  description?: string;

  type?: InspirationType;
  platform?: 'tiktok' | 'instagram' | 'youtube' | 'web' | 'blog';
  url?: string;

  content?: string;
  images?: string[];

  monitoring?: IInspirationMonitoring;

  tags?: string[];
  status?: 'backlog' | 'monitoring' | 'validated' | 'archived' | 'used';

  relatedAssetId?: string;

  auditable?: IAuditable;
  metadata?: any;
}
