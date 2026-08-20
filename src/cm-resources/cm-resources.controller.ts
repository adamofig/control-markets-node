import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppGuard } from '@dataclouder/nest-core';
import { ProjectAuthGuard } from '../user/project-auth.guard';
import { OrgId } from '../common/org-id.decorator';
import { CmResourceResolver } from './cm-resource.resolver';
import { CmResource } from './cm-resource.models';

/**
 * The HTTP door — the one `bin/cm`, curl, Python and n8n use.
 *
 * `ProjectAuthGuard` is what makes a `cm_pat_*` token work here without Firebase, and `@OrgId()`
 * reads the organization that `OrgContextGuard` already validated against Mongo membership.
 *
 * **The organization is never taken from a query parameter.** `?orgId=` would let any PAT holder
 * read any tenant by typing a different string, which is the exact hole the mandatory `orgId` of
 * the resolver exists to close. The address travels in the query; the identity never does.
 */
@ApiTags('cm-resources')
@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/cm')
export class CmResourcesController {
  constructor(private readonly resolver: CmResourceResolver) {}

  @Get('resource')
  @ApiOperation({
    summary: 'Read one document by its cm:// address',
    description:
      'Single read verb over the `cm://` address space. Same URI, same document as the `cmRead` tool and `bin/cm read`.',
  })
  @ApiResponse({ status: 200, description: 'The resolved resource.' })
  @ApiResponse({ status: 400, description: 'Malformed cm:// address, or no organization in the request.' })
  @ApiResponse({ status: 404, description: 'No such resource in the caller organization.' })
  async readResource(@Query('uri') uri: string, @Query('profileId') profileId?: string, @OrgId() orgId?: string): Promise<CmResource> {
    // **No fallback to the caller's user id.** It used to read `orgId || token.userId`, which looks
    // defensive and is the opposite: the platform master token authenticates as the synthetic
    // `system_root` principal, so a request that simply forgot its organization silently became a
    // lookup in a tenant that owns nothing, and every read came back `404 not found` — a lie about
    // the document instead of the truth about the request. The resolver already rejects a missing
    // `orgId` with `400`; letting it do so is the whole fix (task 28).
    return this.resolver.read(uri, { orgId, profileId });
  }
}
