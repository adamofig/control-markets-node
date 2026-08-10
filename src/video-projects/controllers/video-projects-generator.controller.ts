import { Body, Controller, Logger, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { VideoGeneratorService } from '../services/video-project-generator.service';
import { IVideoProjectGenerator } from '../models/video-project.models';
import { VideoGeneratorDocument, VideoGeneratorEntity } from '../schemas/video-project.entity';
import { EntityMongoController } from '@dataclouder/nest-mongo';
import { OrgId } from '../../common/org-id.decorator';
import { AppToken, DecodedToken } from '@dataclouder/nest-auth';
import { ProjectAuthGuard } from '../../user/project-auth.guard';
import { AppGuard } from '@dataclouder/nest-core';
import { isPlatformAdmin } from '../../auth/platform-roles';

/** F10: class-level guard — five routes were guarded one by one, the inherited CRUD ones were not. */
@ApiTags('video-generator')
@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/video-generator')
export class VideoGeneratorController extends EntityMongoController<VideoGeneratorDocument> {
  private readonly logger = new Logger('VideoGeneratorController');

  constructor(private readonly videoGeneratorService: VideoGeneratorService) {
    super(videoGeneratorService);
  }

  @Post('operation')
  @ApiOperation({
    summary: 'Execute a single database operation for Video Projects',
    description: 'Enforces orgId on all Video Project database operations.',
  })
  @ApiResponse({ status: 200, description: 'The operation was successful.' })
  override async executeOperation(
    @Body() operationDto: any,
    @DecodedToken() token: AppToken,
    @OrgId() orgId?: string,
  ): Promise<any> {
    const userEmail = token?.email;
    const isBypass = isPlatformAdmin(token) && operationDto.options?.adminBypass;
    const resolvedOrgId = isBypass ? undefined : (orgId || token?.userId || (token as any).id || (token as any).uid);

    if (isBypass) {
      // Dropping the tenant filter must never happen silently.
      this.logger.warn(`[ADMIN_BYPASS] video-generator ${operationDto.action} | actor=${userEmail ?? '-'} | requestedOrgId=${orgId ?? '-'}`);
    }

    if (operationDto.payload) {
      if (operationDto.action === 'create') {
        operationDto.payload.auditable = {
          ...operationDto.payload.auditable,
          createdBy: userEmail || 'system',
          updatedBy: userEmail || 'system',
        };
        // Inject orgId into payload for new Video Project
        if (resolvedOrgId) {
          operationDto.payload.orgId = resolvedOrgId;
        }
      } else if (operationDto.action === 'updateOne' || operationDto.action === 'updateMany') {
        if (!operationDto.payload.$set) {
          operationDto.payload.$set = {};
        }
        operationDto.payload.$set['auditable.updatedBy'] = userEmail || 'system';
        // Enforce update boundary to only match orgId
        if (resolvedOrgId) {
          operationDto.query = { ...operationDto.query, orgId: resolvedOrgId };
        }
      }
    }

    // Force queries on find/delete actions to only retrieve/modify within the active orgId
    if (resolvedOrgId && (
      operationDto.action === 'find' ||
      operationDto.action === 'findOne' ||
      operationDto.action === 'count' ||
      operationDto.action === 'deleteOne' ||
      operationDto.action === 'deleteMany'
    )) {
      operationDto.query = { ...operationDto.query, orgId: resolvedOrgId };
    }

    return await this.entityCommunicationService.executeOperation(operationDto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a video project item' })
  @ApiResponse({ status: 200, description: 'The item has been successfully updated.', type: VideoGeneratorEntity })
  async partialUpdateGranular(
    @Param('id') id: string,
    @Body() updateVideoProject: Partial<IVideoProjectGenerator>,
    @DecodedToken() token: AppToken,
    @OrgId() orgId?: string,
  ): Promise<VideoGeneratorEntity> {
    const resolvedOrgId = orgId || token?.userId || (token as any).id || (token as any).uid;
    return (await this.videoGeneratorService.partialUpdateFlattend(id, updateVideoProject, resolvedOrgId)) as VideoGeneratorEntity;
  }

  // @Post('query')
  // @ApiOperation({ summary: 'Create a new newComponent item' })
  // @ApiResponse({ status: 201, description: 'The item has been successfully created.', type: VideoGeneratorEntity })
  // async query(@Body() filterConfig: FiltersConfig): Promise<IQueryResponse<VideoGeneratorEntity>> {
  //   return await this.videoGeneratorService.queryUsingFiltersConfig(filterConfig);
  // }

  @Patch(':id/add-source/:sourceId')
  async addSourceToProject(
    @Param('id') id: string,
    @Param('sourceId') sourceId: string,
    @DecodedToken() token: AppToken,
    @OrgId() orgId?: string,
  ) {
    const resolvedOrgId = orgId || token?.userId || (token as any).id || (token as any).uid;
    return this.videoGeneratorService.addSourceToVideoProject(id, sourceId, resolvedOrgId);
  }

  @Patch(':id/add-agent-card/:agentCardId')
  async addAgentCardToProject(
    @Param('id') id: string,
    @Param('agentCardId') agentCardId: string,
    @DecodedToken() token: AppToken,
    @OrgId() orgId?: string,
  ) {
    const resolvedOrgId = orgId || token?.userId || (token as any).id || (token as any).uid;
    return this.videoGeneratorService.addAgentCardToVideoProject(id, agentCardId, resolvedOrgId);
  }

  @Patch(':id/remove-source/:sourceId')
  async removeSourceFromProject(
    @Param('id') id: string,
    @Param('sourceId') sourceId: string,
    @DecodedToken() token: AppToken,
    @OrgId() orgId?: string,
  ) {
    const resolvedOrgId = orgId || token?.userId || (token as any).id || (token as any).uid;
    return this.videoGeneratorService.removeSourceFromVideoProject(id, sourceId, resolvedOrgId);
  }
}
