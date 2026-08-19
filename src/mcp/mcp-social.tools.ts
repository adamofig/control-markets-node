import { Injectable } from '@nestjs/common';
import { Tool, ToolScopes } from '@rekog/mcp-nest';
import { z } from 'zod';
import { SocialMediaTrackerService } from '../social-media-tracker/services/social-media-tracker.service';
import { assertDocumentInOrg, requireMcpContext, scopeMcpOperation, scopedQuery } from './mcp-scope.util';
import { MCP_SCOPES } from './mcp-scopes';

const preprocessJson = (val: unknown) => {
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  return val;
};

// Shared operation schema — mirrors OperationDto from @dataclouder/nest-mongo
const operationSchema = z.object({
  action: z
    .enum(['find', 'findOne', 'create', 'updateOne', 'updateMany', 'deleteOne', 'aggregate', 'clone'])
    .describe(
      `MongoDB operation.
find/findOne → use query, projection, options.
create → use payload.
updateOne/updateMany → use query + payload (supports $set, $push, etc).
deleteOne → use query.
aggregate → use payload as pipeline array.
clone → use query with _id.`,
    ),
  query: z.preprocess(preprocessJson, z.record(z.string(), z.unknown())).optional().describe('MongoDB filter (e.g. { "platform": "tiktok", "status": "draft" }).'),
  payload: z.preprocess(preprocessJson, z.unknown()).optional().describe('Document for create, update payload, or aggregate pipeline array.'),
  projection: z.preprocess(preprocessJson, z.record(z.string(), z.unknown())).optional().describe('Fields to include/exclude (e.g. { "name": 1, "scheduledDate": 1 }).'),
  options: z.preprocess(preprocessJson, z.record(z.string(), z.unknown())).optional().describe('Mongoose options (e.g. { "sort": { "scheduledDate": 1 }, "limit": 50 }).'),
});

type OperationInput = z.infer<typeof operationSchema>;

@Injectable()
export class McpSocialTools {
  constructor(private socialService: SocialMediaTrackerService) {}

  @ToolScopes([MCP_SCOPES.social])
  @Tool({
    name: 'social_operation',
    description: `Execute any MongoDB operation on the social_media_tracker collection.
Use this for advanced queries, bulk updates, aggregations, or anything the convenience tools don't cover.
Key fields:
  name          — Title or short name for the post.
  platform      — "tiktok" | "instagram" | "youtube".
  status        — "draft" | "scheduled" | "published".
  scheduledDate — ISO date for when the post should go live.
  description   — Post caption or content body.
  videoUrl      — URL of the associated video asset.
  notes         — Internal notes.
  orgId         — Organization this post belongs to.
  emoji         — 1 or 2 emoji characters to identify great performance posts.

Prefer social_listPosts / social_getPostsThisWeek / social_getPost / social_createPost / social_updatePost for common operations.`,
    parameters: operationSchema,
  })
  async socialOperation(operation: OperationInput, _context: unknown, request: any) {
    scopeMcpOperation(operation, requireMcpContext(request), 'social_operation');
    const result = await this.socialService.executeOperation(operation);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @ToolScopes([MCP_SCOPES.social])
  @Tool({
    name: 'social_listPosts',
    description:
      'List social media posts. Optionally filter by platform (tiktok, instagram, youtube) and/or status (draft, scheduled, published). Returns posts ordered by scheduledDate.',
    parameters: z.object({
      platform: z.enum(['tiktok', 'instagram', 'youtube']).optional().describe('Filter by social platform.'),
      status: z.enum(['draft', 'scheduled', 'published']).optional().describe('Filter by post status.'),
    }),
  })
  async listScheduledPosts({ platform, status }: { platform?: string; status?: string }, _context: unknown, request: any) {
    const query: any = scopedQuery(requireMcpContext(request));
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

  @ToolScopes([MCP_SCOPES.social])
  @Tool({
    name: 'social_getPostsThisWeek',
    description: 'Get all social media posts scheduled for the current week (Monday to Sunday).',
    parameters: z.object({
      platform: z.enum(['tiktok', 'instagram', 'youtube']).optional().describe('Optionally filter by platform.'),
    }),
  })
  async getPostsThisWeek({ platform }: { platform?: string }, _context: unknown, request: any) {
    const identity = requireMcpContext(request);
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const query: any = scopedQuery(identity, {
      scheduledDate: { $gte: monday, $lte: sunday },
    });
    if (platform) query.platform = platform;

    const result = await this.socialService.queryUsingFiltersConfig({
      filters: query,
      sort: { scheduledDate: 1 },
      rowsPerPage: 50,
      page: 1,
    });

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @ToolScopes([MCP_SCOPES.social])
  @Tool({
    name: 'social_getPost',
    description: 'Get the full details of a single social media post by its ID.',
    parameters: z.object({
      postId: z.string().describe('The ID of the social media post.'),
    }),
  })
  async getSocialPost({ postId }: { postId: string }, _context: unknown, request: any) {
    const identity = requireMcpContext(request);
    // Id-addressed read: there is no filter to rewrite, so the ownership check happens on the way
    // out — the same thing `OrgScopeInterceptor.scopeResponse` does for `GET /:id`.
    const result = assertDocumentInOrg(await this.socialService.findOne(postId), identity, 'social_getPost', `Post ${postId}`);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @ToolScopes([MCP_SCOPES.social])
  @Tool({
    name: 'social_createPost',
    description: 'Create a new social media post entry in the tracker.',
    parameters: z.object({
      name: z.string().describe('Title or short name for the post.'),
      platform: z.enum(['tiktok', 'instagram', 'youtube']).describe('Target platform.'),
      description: z.string().optional().describe('Content or caption for the post.'),
      scheduledDate: z.string().optional().describe('ISO 8601 date string for when to publish (e.g. 2025-04-10T10:00:00Z).'),
      status: z.enum(['draft', 'scheduled', 'published']).optional().default('draft').describe('Post status.'),
      notes: z.string().optional().describe('Internal notes about this post.'),
      videoUrl: z.string().optional().describe('URL of the video asset if already generated.'),
      emoji: z.string().max(8).optional().describe('1 or 2 emoji characters to identify great performance posts.'),
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
    emoji?: string;
  }, _context: unknown, request: any) {
    const identity = requireMcpContext(request);
    const result = await this.socialService.save({
      ...dto,
      // The document is being born: the org is stamped, not filtered — `CREATE_ACTIONS` of the
      // shared rulebook, applied by hand because `save()` is not operation-shaped.
      orgId: identity.orgId,
      scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : undefined,
      status: dto.status ?? 'draft',
    });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @ToolScopes([MCP_SCOPES.social])
  @Tool({
    name: 'social_updatePost',
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
      emoji: z.string().max(8).optional().describe('Updated emoji indicator.'),
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
    emoji?: string;
  }, _context: unknown, request: any) {
    const identity = requireMcpContext(request);
    // `partialUpdate` is id-addressed, so the document is read under the caller's org before it is
    // written — the gap F14a documented as structurally open for REST, closed here because a tool
    // call has no UI in front of it to make the mistake unlikely.
    assertDocumentInOrg(await this.socialService.findOne(postId), identity, 'social_updatePost', `Post ${postId}`);

    const updates: any = { ...rest };
    if (scheduledDate) updates.scheduledDate = new Date(scheduledDate);
    // Never let an update move a row into another organization.
    delete updates.orgId;

    const result = await this.socialService.partialUpdate(postId, updates);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
}
