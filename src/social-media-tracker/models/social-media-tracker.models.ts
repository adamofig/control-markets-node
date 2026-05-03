import { IStorageAsset } from '@dataclouder/nest-storage';

export type SocialPlatform = 'tiktok' | 'instagram' | 'youtube';
export type PostStatus = 'draft' | 'scheduled' | 'published';

export interface ISocialMediaTracker {
  _id?: string;
  id?: string;
  orgId?: string;

  name?: string;
  description?: string;
  
  asset?: string | IStorageAsset;
  
  scheduledDate?: Date | string;
  platform?: string;
  platforms?: any[];
  breakdown?: string;
  status?: string;
  notes?: string;
  videoUrl?: string;
}
