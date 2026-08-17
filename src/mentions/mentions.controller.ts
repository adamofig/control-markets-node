import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AppGuard } from '@dataclouder/nest-core';
import { ProjectAuthGuard } from '../user/project-auth.guard';
import { OrgId } from '../common/org-id.decorator';
import { MentionsService } from './mentions.service';
import { MENTION_SEARCH_LIMIT } from './mention-ranking.util';
import { IMentionOption, MentionKind } from './models/mention.models';

const VALID_KINDS: MentionKind[] = ['knowledge', 'skill', 'exploration', 'memory', 'task', 'org_source', 'agentic_profile'];

@ApiTags('Mentions')
@ApiBearerAuth()
@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/mentions')
export class MentionsController {
  constructor(private readonly mentionsService: MentionsService) {}

  /**
   * Catalog for the `@` menu.
   *
   * The organization comes from `@OrgId()` — `req.ctx.orgId`, which `OrgContextGuard` resolved
   * against the caller's membership in Mongo. There is no `orgId` query parameter on purpose: a
   * client may *ask* for an organization through the `x-org-id` header, which the guard validates,
   * and may never *assert* one on a route that reads data.
   *
   * `profileId` only widens the answer with that profile's own resources, and the resolver checks
   * the profile belongs to the same organization, so passing someone else's id adds nothing.
   */
  @Get('search')
  @ApiOperation({ summary: 'Search mentionable resources of the active organization (profile resources first)' })
  @ApiQuery({ name: 'q', required: false, description: 'Free text; empty returns the most recent rows' })
  @ApiQuery({ name: 'profileId', required: false, description: 'Active agentic profile, to include its linked resources' })
  @ApiQuery({ name: 'kinds', required: false, description: 'Comma-separated kinds to restrict the search' })
  @ApiQuery({ name: 'limit', required: false, description: `Rows to return (default ${MENTION_SEARCH_LIMIT}, max 50)` })
  async search(
    @OrgId() orgId: string,
    @Query('q') q?: string,
    @Query('profileId') profileId?: string,
    @Query('kinds') kinds?: string,
    @Query('limit') limit?: string,
  ): Promise<{ options: IMentionOption[] }> {
    const requestedKinds = (kinds || '')
      .split(',')
      .map(kind => kind.trim())
      .filter((kind): kind is MentionKind => VALID_KINDS.includes(kind as MentionKind));

    const options = await this.mentionsService.search(
      q || '',
      { orgId, profileId: profileId || undefined },
      { kinds: requestedKinds.length ? requestedKinds : undefined, limit: limit ? parseInt(limit, 10) || undefined : undefined },
    );
    return { options };
  }
}
