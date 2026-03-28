export enum RecentResourceCollection {
  AGENT_FLOWS = 'agent_flows',
  AGENT_TASKS = 'agent_tasks',
  AGENT_CARDS = 'agent_cards',
  SOCIAL_MEDIA_TRACKER = 'social_media_tracker',
}

export interface IRecentResource {
  id?: string;
  userId: string;
  resourceId: string;
  collection: RecentResourceCollection;
  name: string;
  accessedAt: Date;
}

export interface TrackResourceDto {
  resourceId: string;
  collection: RecentResourceCollection;
  name: string;
}
