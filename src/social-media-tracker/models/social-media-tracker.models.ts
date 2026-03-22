import { IAuditable } from '@dataclouder/nest-core';

export type SocialPlatform = 'tiktok' | 'instagram' | 'youtube';
export type PostStatus = 'draft' | 'scheduled' | 'published';

export interface ISocialMediaTracker {
  _id?: string;
  id?: string;
  orgId?: string;
  name?: string;
  description?: string;
  asset?: any;
  auditable?: IAuditable;
  scheduledDate?: Date | string;
  platform?: string;
  status?: string;
  notes?: string;
  videoUrl?: string;
}
