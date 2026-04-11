import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { SocialMediaTrackerService } from '../social-media-tracker/services/social-media-tracker.service';

@Injectable()
export class McpSocialTools {
  constructor(private socialService: SocialMediaTrackerService) {}

  @Tool({
    name: 'listScheduledPosts',
    description:
      'List social media posts. Optionally filter by platform (tiktok, instagram, youtube) and/or status (draft, scheduled, published). Returns posts ordered by scheduledDate.',
    parameters: z.object({
      platform: z.enum(['tiktok', 'instagram', 'youtube']).optional().describe('Filter by social platform.'),
      status: z.enum(['draft', 'scheduled', 'published']).optional().describe('Filter by post status.'),
    }),
  })
  async listScheduledPosts({ platform, status }: { platform?: string; status?: string }) {
    const query: any = {};
    if (platform) query.platform = platform;
    if (status) query.status = status;

    const result = await this.socialService.queryUsingFiltersConfig({
      filters: query,
      sort: { scheduledDate: 1 },
      rowsPerPage: 100,
      page: 1,
    });

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @Tool({
    name: 'getPostsThisWeek',
    description: 'Get all social media posts scheduled for the current week (Monday to Sunday).',
    parameters: z.object({
      platform: z.enum(['tiktok', 'instagram', 'youtube']).optional().describe('Optionally filter by platform.'),
    }),
  })
  async getPostsThisWeek({ platform }: { platform?: string }) {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const query: any = {
      scheduledDate: { $gte: monday, $lte: sunday },
    };
    if (platform) query.platform = platform;

    const result = await this.socialService.queryUsingFiltersConfig({
      filters: query,
      sort: { scheduledDate: 1 },
      rowsPerPage: 50,
      page: 1,
    });

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @Tool({
    name: 'getSocialPost',
    description: 'Get the full details of a single social media post by its ID.',
    parameters: z.object({
      postId: z.string().describe('The ID of the social media post.'),
    }),
  })
  async getSocialPost({ postId }: { postId: string }) {
    const result = await this.socialService.findOne(postId);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @Tool({
    name: 'createSocialPost',
    description: 'Create a new social media post entry in the tracker.',
    parameters: z.object({
      name: z.string().describe('Title or short name for the post.'),
      platform: z.enum(['tiktok', 'instagram', 'youtube']).describe('Target platform.'),
      description: z.string().optional().describe('Content or caption for the post.'),
      scheduledDate: z.string().optional().describe('ISO 8601 date string for when to publish (e.g. 2025-04-10T10:00:00Z).'),
      status: z.enum(['draft', 'scheduled', 'published']).optional().default('draft').describe('Post status.'),
      notes: z.string().optional().describe('Internal notes about this post.'),
      videoUrl: z.string().optional().describe('URL of the video asset if already generated.'),
    }),
  })
  async createSocialPost(dto: {
    name: string;
    platform: string;
    description?: string;
    scheduledDate?: string;
    status?: string;
    notes?: string;
    videoUrl?: string;
  }) {
    const result = await this.socialService.save({
      ...dto,
      scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : undefined,
      status: dto.status ?? 'draft',
    });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @Tool({
    name: 'updateSocialPost',
    description: 'Update fields of an existing social media post.',
    parameters: z.object({
      postId: z.string().describe('The ID of the post to update.'),
      name: z.string().optional().describe('New title or name.'),
      platform: z.enum(['tiktok', 'instagram', 'youtube']).optional().describe('Change target platform.'),
      description: z.string().optional().describe('New content or caption.'),
      scheduledDate: z.string().optional().describe('New ISO 8601 scheduled date.'),
      status: z.enum(['draft', 'scheduled', 'published']).optional().describe('New status.'),
      notes: z.string().optional().describe('Updated internal notes.'),
      videoUrl: z.string().optional().describe('Updated video URL.'),
    }),
  })
  async updateSocialPost({
    postId,
    scheduledDate,
    ...rest
  }: {
    postId: string;
    name?: string;
    platform?: string;
    description?: string;
    scheduledDate?: string;
    status?: string;
    notes?: string;
    videoUrl?: string;
  }) {
    const updates: any = { ...rest };
    if (scheduledDate) updates.scheduledDate = new Date(scheduledDate);

    const result = await this.socialService.partialUpdate(postId, updates);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
}
