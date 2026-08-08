import { BadRequestException, Controller, Post, Body, UseGuards, Get, Param, Query, Put } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { EntityMongoController } from '@dataclouder/nest-mongo';
import { AgenticProfileDocument } from '../schemas/agentic-profile.schema';
import { AgenticProfileService } from '../services/agentic-profile.service';
import { OrgId } from '../../common/org-id.decorator';
import { AppToken, AuthGuard, DecodedToken } from '@dataclouder/nest-auth';
import { ProjectAuthGuard } from '../../user/project-auth.guard';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AgenticContextLevel, IAgenticProfileAcpConfig, IAgenticProfileSkill, ISkillCatalogItem, ISkillLinkInput } from '../models/agentic-profile.models';

@ApiTags('agentic-profile')
@Controller('api/agentic-profile')
export class AgenticProfileController extends EntityMongoController<AgenticProfileDocument> {
  constructor(
    private readonly agenticProfileService: AgenticProfileService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
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

    const result = await this.entityCommunicationService.executeOperation(operationDto);
    if (operationDto.action !== 'find' && operationDto.action !== 'findOne') return result;
    const withNextRun = (profile: any) => {
      if (!profile) return profile;
      const id = profile.id || profile._id?.toString?.();
      let nextRunAt: string | null = null;
      if (id && this.schedulerRegistry.doesExist('cron', `agentic-heartbeat:${id}`)) {
        nextRunAt = this.schedulerRegistry.getCronJob(`agentic-heartbeat:${id}`).nextDate()?.toISO() ?? null;
      }
      return { ...(profile.toObject?.() ?? profile), nextRunAt };
    };
    const profiles = (Array.isArray(result) ? result : [result]).filter(Boolean).map(withNextRun);
    // Task refs are a stale snapshot until refreshed against `agent_tasks` — one batched query for the whole response.
    await this.agenticProfileService.hydrateTaskRefs(profiles);
    return Array.isArray(result) ? profiles : (profiles[0] ?? result);
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

  @Get(':id/sync-manifest')
  @ApiOperation({
    summary: 'Sync manifest for the markdown delta push (public, same trust level as sync-markdown)',
    description: 'Returns sourceUrl → contentHash for every source/task of the profile so the CLI only sends changed files.',
  })
  @ApiResponse({ status: 200, description: 'Returns the manifest of synced files and their content hashes.' })
  async getSyncManifest(
    @Param('id') id: string,
    @Query('orgId') orgId?: string,
  ): Promise<any> {
    return this.agenticProfileService.getSyncManifest(id, orgId);
  }

  @Put(':id/live-briefing')
  @ApiOperation({
    summary: 'Update the Section 8 live briefing (owner note) of an agentic profile',
    description: 'Persists the owner-written briefing and mirrors it into the local .md (Section 8) when write-back is enabled.',
  })
  @ApiResponse({ status: 200, description: 'Live briefing saved.' })
  @UseGuards(ProjectAuthGuard)
  async updateLiveBriefing(
    @Param('id') id: string,
    @Body() body: { liveBriefing: string },
    @OrgId() orgId?: string,
    @DecodedToken() token?: AppToken,
  ): Promise<{ liveBriefing: string }> {
    const resolvedOrgId = orgId || token?.userId || (token as any)?.id || (token as any)?.uid;
    return this.agenticProfileService.updateLiveBriefing(id, body?.liveBriefing ?? '', resolvedOrgId);
  }

  @Put(':id/acp-config')
  @ApiOperation({
    summary: 'Update the profile default ACP engine/model (acpConfig)',
    description:
      'Seeds new chats and cron wake-ups. Sending no engine unsets the whole block so the server default applies again. Never locks a session: the chat header still overrides it per session.',
  })
  @ApiResponse({ status: 200, description: 'Default engine/model saved (returns the sanitized config).' })
  @UseGuards(ProjectAuthGuard)
  async updateAcpConfig(
    @Param('id') id: string,
    @Body() body: IAgenticProfileAcpConfig,
    @OrgId() orgId?: string,
    @DecodedToken() token?: AppToken,
  ): Promise<IAgenticProfileAcpConfig> {
    const resolvedOrgId = orgId || token?.userId || (token as any)?.id || (token as any)?.uid;
    return this.agenticProfileService.updateAcpConfig(id, body, resolvedOrgId);
  }

  @Get('skills/catalog')
  @ApiOperation({
    summary: 'List every skill source available in the organization',
    description: 'Feeds the profile UI so a user can check which skills an agent may use. Org-scoped and read-only.',
  })
  @ApiResponse({ status: 200, description: 'Returns the org skill catalog.' })
  @UseGuards(ProjectAuthGuard)
  async getSkillCatalog(@OrgId() orgId?: string, @DecodedToken() token?: AppToken): Promise<ISkillCatalogItem[]> {
    const resolvedOrgId = orgId || token?.userId || (token as any)?.id || (token as any)?.uid;
    return this.agenticProfileService.listSkillCatalog(resolvedOrgId);
  }

  @Put(':id/skills')
  @ApiOperation({
    summary: 'Replace the skills linked to an agentic profile',
    description:
      'Accepts ids and enabled flags only; labels are re-read from the org sources. Skills the markdown declares keep origin "markdown" (the .md stays their source of truth), the rest are stored as "platform" and survive the next sync.',
  })
  @ApiResponse({ status: 200, description: 'Returns the persisted skill refs.' })
  @UseGuards(ProjectAuthGuard)
  async updateSkills(
    @Param('id') id: string,
    @Body() body: { skills: ISkillLinkInput[] },
    @OrgId() orgId?: string,
    @DecodedToken() token?: AppToken,
  ): Promise<IAgenticProfileSkill[]> {
    const resolvedOrgId = orgId || token?.userId || (token as any)?.id || (token as any)?.uid;
    return this.agenticProfileService.updateSkillLinks(id, body?.skills, resolvedOrgId);
  }

  @Get(':id/full-context')
  @ApiOperation({
    summary: 'Retrieve the compiled Markdown context for the agent',
  })
  @ApiResponse({ status: 200, description: 'Returns the compiled Markdown context text.' })
  @UseGuards(ProjectAuthGuard)
  async getFullContext(
    @Param('id') id: string,
    @Query('level') level: AgenticContextLevel | undefined,
    @OrgId() orgId?: string,
    @DecodedToken() token?: AppToken,
  ): Promise<{ fullContextMarkdown: string }> {
    if (level && !['basic', 'medium', 'full'].includes(level)) {
      throw new BadRequestException('level must be one of: basic, medium, full');
    }
    const resolvedOrgId = orgId || token?.userId || (token as any).id || (token as any).uid;
    const fullContextMarkdown = await this.agenticProfileService.composeFullContext(id, resolvedOrgId, level);
    return { fullContextMarkdown };
  }
}
