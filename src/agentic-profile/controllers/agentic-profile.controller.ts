import { Controller, Post, Body, UseGuards, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { EntityMongoController } from '@dataclouder/nest-mongo';
import { AgenticProfileDocument } from '../schemas/agentic-profile.schema';
import { AgenticProfileService } from '../services/agentic-profile.service';
import { OrgId } from '../../common/org-id.decorator';
import { AppToken, AuthGuard, DecodedToken } from '@dataclouder/nest-auth';
import { ProjectAuthGuard } from '../../user/project-auth.guard';

@ApiTags('agentic-profile')
@Controller('api/agentic-profile')
export class AgenticProfileController extends EntityMongoController<AgenticProfileDocument> {
  constructor(private readonly agenticProfileService: AgenticProfileService) {
    super(agenticProfileService);
  }

  @Post('operation')
  @ApiOperation({
    summary: 'Execute a single database operation for Agentic Profiles',
    description: 'Enforces orgId on all Agentic Profile database operations.',
  })
  @ApiResponse({ status: 200, description: 'The operation was successful.' })
  @UseGuards(ProjectAuthGuard)
  override async executeOperation(
    @Body() operationDto: any,
    @DecodedToken() token: AppToken,
    @OrgId() orgId?: string,
  ): Promise<any> {
    const userEmail = token?.email;
    const isAdmin = token?.roles?.admin || token?.claims?.roles?.admin;
    const isBypass = isAdmin && operationDto.options?.adminBypass;
    const resolvedOrgId = isBypass ? undefined : (orgId || token?.userId || (token as any).id || (token as any).uid);

    if (operationDto.payload) {
      if (operationDto.action === 'create') {
        operationDto.payload.auditable = {
          ...operationDto.payload.auditable,
          createdBy: userEmail || 'system',
          updatedBy: userEmail || 'system',
        };
        // Inject orgId into payload for new Agentic Profile
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

  @Post('sync-markdown')
  @ApiOperation({
    summary: 'Sync local Markdown agent profile specs to database (public)',
  })
  @ApiResponse({ status: 200, description: 'The synchronization was successful.' })
  async syncMarkdown(@Body() payload: any): Promise<any> {
    const orgId = payload.orgId;
    const userEmail = payload.userEmail || 'adamo.figuero@gmail.com';
    return this.agenticProfileService.syncFromMarkdown(payload, orgId, userEmail);
  }

  @Get(':id/full-context')
  @ApiOperation({
    summary: 'Retrieve the compiled Markdown context for the agent',
  })
  @ApiResponse({ status: 200, description: 'Returns the compiled Markdown context text.' })
  @UseGuards(ProjectAuthGuard)
  async getFullContext(
    @Param('id') id: string,
    @OrgId() orgId?: string,
    @DecodedToken() token?: AppToken,
  ): Promise<{ fullContextMarkdown: string }> {
    const resolvedOrgId = orgId || token?.userId || (token as any).id || (token as any).uid;
    const fullContextMarkdown = await this.agenticProfileService.composeFullContext(id, resolvedOrgId);
    return { fullContextMarkdown };
  }
}
