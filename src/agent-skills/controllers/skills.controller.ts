import { Controller, Get, Param, Query, UseGuards, Body, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EntityMongoController } from '@dataclouder/nest-mongo';
import { SkillDocument } from '../schemas/skill.schema';
import { SkillsService } from '../services/skills.service';
import { OrgId } from '../../common/org-id.decorator';
import { AppToken, DecodedToken } from '@dataclouder/nest-auth';
import { ProjectAuthGuard } from '../../user/project-auth.guard';
import { IResolvedSkill, ISkillCatalogEntry } from '../models/skill.models';

@ApiTags('skills')
@Controller('api/skills')
export class SkillsController extends EntityMongoController<SkillDocument> {
  constructor(private readonly skillsService: SkillsService) {
    super(skillsService);
  }

  @Post('operation')
  @ApiOperation({
    summary: 'Execute a single database operation for Skills',
    description: 'Enforces orgId on every Skill database operation.',
  })
  @ApiResponse({ status: 200, description: 'The operation was successful.' })
  @UseGuards(ProjectAuthGuard)
  override async executeOperation(@Body() operationDto: any, @DecodedToken() token?: AppToken, @OrgId() orgId?: string): Promise<any> {
    const resolvedOrgId = this.resolveOrgId(orgId, token);
    const userEmail = token?.email;

    if (operationDto?.payload) {
      if (operationDto.action === 'create') {
        operationDto.payload.auditable = {
          ...operationDto.payload.auditable,
          createdBy: userEmail || 'system',
          updatedBy: userEmail || 'system',
        };
        if (resolvedOrgId) operationDto.payload.orgId = resolvedOrgId;
      } else if (operationDto.action === 'updateOne' || operationDto.action === 'updateMany') {
        if (!operationDto.payload.$set) operationDto.payload.$set = {};
        operationDto.payload.$set['auditable.updatedBy'] = userEmail || 'system';
        if (resolvedOrgId) operationDto.query = { ...operationDto.query, orgId: resolvedOrgId };
      }
    }

    const scopedActions = ['find', 'findOne', 'count', 'deleteOne', 'deleteMany'];
    if (resolvedOrgId && scopedActions.includes(operationDto?.action)) {
      operationDto.query = { ...operationDto.query, orgId: resolvedOrgId };
    }

    return this.entityCommunicationService.executeOperation(operationDto);
  }

  @Get('catalog')
  @ApiOperation({
    summary: 'List every skill bundle of the organization with its capability index',
    description: 'Metadata only — never returns skill bodies. Feeds the profile UI and the `@` autocomplete.',
  })
  @ApiResponse({ status: 200, description: 'Returns the org skill catalog.' })
  @UseGuards(ProjectAuthGuard)
  async getCatalog(@OrgId() orgId?: string, @DecodedToken() token?: AppToken): Promise<ISkillCatalogEntry[]> {
    return this.skillsService.listCatalog(this.resolveOrgId(orgId, token));
  }

  @Get('resolve/:slugOrId')
  @ApiOperation({
    summary: 'Fetch one skill bundle or atomic capability on demand',
    description:
      'Accepts a Mongo id or a slug (`agent-profile-specs`, `agent-profile-specs:send-inbox`). Optional `file` narrows the response to a single embedded document of the bundle. Scripts are returned as paths, never as content.',
  })
  @ApiResponse({ status: 200, description: 'Returns the resolved skill content.' })
  @ApiResponse({ status: 404, description: 'Unknown slug/id, or a file that does not belong to the skill.' })
  @UseGuards(ProjectAuthGuard)
  async resolveSkill(
    @Param('slugOrId') slugOrId: string,
    @Query('file') file?: string,
    @OrgId() orgId?: string,
    @DecodedToken() token?: AppToken,
  ): Promise<IResolvedSkill> {
    return this.skillsService.resolve(slugOrId, this.resolveOrgId(orgId, token), file);
  }

  /** Same fallback chain the rest of the platform uses: header first, then the token identity. */
  private resolveOrgId(orgId?: string, token?: AppToken): string | undefined {
    return orgId || token?.userId || (token as any)?.id || (token as any)?.uid;
  }
}
