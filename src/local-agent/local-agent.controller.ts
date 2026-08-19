import { Body, Controller, Get, Logger, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppToken } from '@dataclouder/nest-auth';
import { AppGuard } from '@dataclouder/nest-core';
import { ProjectAuthGuard } from '../user/project-auth.guard';
import { FastifyReply } from 'fastify';
import { DecodedToken } from '../common/token.decorator';
import { LocalAgentChatService, LocalAgentMessage, LocalAgentStreamEvent } from './local-agent-chat.service';
import { AcpBridgeService, AcpEngine, CodexReasoningEffort, DEFAULT_ACP_ENGINE } from './acp-bridge.service';
import { AttachedSourceReport } from './attached-sources.util';
import { AgenticProfileService } from '../agentic-profile/services/agentic-profile.service';
import { IAgenticProfileAcpConfig, IAttachedSourceRef } from '../agentic-profile/models/agentic-profile.models';
import { WorkspaceService } from '../workspaces/services/workspace.service';
import { asAcpEngine } from '../common/acp-engines';
import { OrgId } from '../common/org-id.decorator';

class LocalAgentChatRequestDto {
  messages: LocalAgentMessage[];
  agenticProfileId?: string;
  /**
   * @deprecated Ignored since the universal mention system. The organization is resolved by the
   * server from `req.ctx` (`x-org-id` header validated against the caller's membership). Kept in the
   * DTO so an older client keeps compiling, never read.
   */
  orgId?: string;
  attachedSources?: IAttachedSourceRef[];
}

class AcpStreamRequestDto {
  message: string;
  sessionId?: string;
  agenticProfileId?: string;
  /** @deprecated Ignored — see `LocalAgentChatRequestDto.orgId`. */
  orgId?: string;
  engine?: AcpEngine;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  /** Resources the user pinned to this turn with `@`. Their `kind` is a hint; the server decides. */
  attachedSources?: IAttachedSourceRef[];
}

class AcpPermissionRequestDto {
  sessionId: string;
  requestId: string;
  optionId: string;
}

@ApiTags('Local Agent')
@ApiBearerAuth()
// `ProjectAuthGuard`, no el `AuthGuard` de la librería: este controlador ES el endpoint de los agentes
// CLI (`agy`, `claude`, `codex`) por ACP, o sea justo los clientes headless que se autentican con un
// `cm_pat_*`. Con el guard de Firebase el guard global autenticaba el PAT y este lo rechazaba después.
@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/local-agent')
export class LocalAgentController {
  private readonly logger = new Logger(LocalAgentController.name);

  constructor(
    private readonly localAgentChatService: LocalAgentChatService,
    private readonly acpBridge: AcpBridgeService,
    private readonly agenticProfileService: AgenticProfileService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Report whether local agent mode is enabled and which workspace roots are mounted' })
  async getStatus() {
    const acp = await this.acpBridge.getAcpStatus();
    return { ...this.localAgentChatService.getStatus(), ...acp };
  }

  @Post('stream')
  @ApiOperation({ summary: 'Stream a local agent chat with profile context and filesystem tools (structured SSE events)' })
  async streamChat(@Body() body: LocalAgentChatRequestDto, @Res() res: FastifyReply, @DecodedToken() token: AppToken, @OrgId() orgId: string) {
    res.raw.setHeader('Content-Type', 'text/event-stream');
    res.raw.setHeader('Cache-Control', 'no-cache');
    res.raw.setHeader('Connection', 'keep-alive');
    res.raw.setHeader('Access-Control-Allow-Origin', '*');

    this.warnOnBodyOrgId(body.orgId, orgId, token);
    const events = this.localAgentChatService.streamChat(body.messages, token, body.agenticProfileId, orgId, body.attachedSources);
    await this.pipeSse(events, res);
  }

  @Post('acp/stream')
  @ApiOperation({ summary: 'Stream a chat turn through a local ACP CLI engine — agy (default), claude or codex (structured SSE events)' })
  async streamAcp(@Body() body: AcpStreamRequestDto, @Res() res: FastifyReply, @DecodedToken() token: AppToken, @OrgId() orgId: string) {
    res.raw.setHeader('Content-Type', 'text/event-stream');
    res.raw.setHeader('Cache-Control', 'no-cache');
    res.raw.setHeader('Connection', 'keep-alive');
    res.raw.setHeader('Access-Control-Allow-Origin', '*');

    this.warnOnBodyOrgId(body.orgId, orgId, token);
    const resolvedOrgId = orgId;

    // A profile bound to a workspace chats from that workspace's root on this host, and its
    // acpConfig is the default engine/model when the request does not name one.
    // Resolved BEFORE the context is compiled: which engine and which cwd this turn runs on is
    // what decides whether the index may name a tool or print a path.
    let cwd: string | undefined;
    let acpConfig: IAgenticProfileAcpConfig | undefined;
    if (body.agenticProfileId) {
      const profile = await this.agenticProfileService
        .executeOperation({ action: 'findOne', query: { id: body.agenticProfileId } })
        .catch(() => null);
      cwd = this.workspaceService.resolveRootForHost(profile?.workspaceId) ?? undefined;
      acpConfig = profile?.acpConfig;
      this.logger.log(`[ACP Stream] AgenticProfile '${profile?.name || body.agenticProfileId}' workspaceId='${profile?.workspaceId}' -> resolved CWD='${cwd ?? 'fallback'}'`);
    } else {
      this.logger.log(`[ACP Stream] Request has no agenticProfileId; CWD will fallback to default workspace root.`);
    }

    const engine = asAcpEngine(body.engine) ?? acpConfig?.defaultEngine ?? DEFAULT_ACP_ENGINE;

    // The profile's model/effort belong to its own defaultEngine. Model ids are not portable across
    // engines, so a request that switches engine gets that engine's adapter default instead of an id
    // the CLI would reject.
    const profileDefaultsApply = !!acpConfig?.defaultEngine && engine === acpConfig.defaultEngine;
    const model = body.model?.trim() || (profileDefaultsApply ? acpConfig?.defaultModel : undefined);
    const reasoningEffort = body.reasoningEffort ?? (profileDefaultsApply ? acpConfig?.reasoningEffort : undefined);

    const runtime = this.acpBridge.describeRuntime(engine, cwd);

    // The standing profile context is a first-turn concern: the CLI keeps it in session history.
    let profileContext: string | undefined;
    if (body.agenticProfileId && !body.sessionId) {
      profileContext = await this.localAgentChatService.getProfileContext(body.agenticProfileId, resolvedOrgId, undefined, runtime).catch(() => undefined);
    }

    // `@mention` attachments are a per-turn concern, so they are resolved on EVERY request —
    // deliberately outside the `!sessionId` guard above. The profile is optional: a mention may
    // point at an organization resource, which a chat without a profile can attach too.
    let attached: { markdown: string; attached: AttachedSourceReport[] } | null = null;
    if (body.attachedSources?.length) {
      attached = await this.localAgentChatService
        .buildAttachedSourcesBlock(body.agenticProfileId, body.attachedSources, resolvedOrgId)
        .catch(() => null);
    }

    const acpEvents = this.acpBridge.stream(
      body.message,
      body.sessionId,
      profileContext,
      engine,
      { model, reasoningEffort, cwd },
      attached?.markdown || undefined,
    );

    const preamble: LocalAgentStreamEvent[] = [];
    if (profileContext) preamble.push({ type: 'context-snapshot', context: this.localAgentChatService.createContextSnapshot(profileContext, runtime) });
    if (attached?.attached.length) preamble.push({ type: 'attached-sources', attached: attached.attached });
    await this.pipeSse(preamble.length ? this.withPreamble(preamble, acpEvents) : acpEvents, res);
  }

  @Post('acp/permission')
  @ApiOperation({ summary: 'Answer a pending ACP tool permission request' })
  respondAcpPermission(@Body() body: AcpPermissionRequestDto) {
    return this.acpBridge.respondPermission(body.sessionId, body.requestId, body.optionId);
  }

  @Post('acp/cancel')
  @ApiOperation({ summary: 'Cancel the in-flight ACP turn for a session' })
  cancelAcp(@Body() body: { sessionId: string }) {
    return this.acpBridge.cancel(body.sessionId);
  }

  /**
   * Records a client that still sends `orgId` in the body.
   *
   * The field used to win over the token, which was fine while every mention had to be linked to the
   * requested profile — a foreign `orgId` simply failed to find the profile. Universal mentions
   * removed that accidental net: the organization became the only thing standing between a caller
   * and another tenant's sources, so it can no longer come from the payload. The client may still
   * *ask* for an organization through `x-org-id`, which `OrgContextGuard` validates against its
   * membership before `@OrgId()` reads it.
   *
   * Kept as a warning rather than a rejection because the value is now inert; the log is there to
   * find the callers that need updating.
   */
  private warnOnBodyOrgId(bodyOrgId: string | undefined, resolvedOrgId: string | undefined, token: AppToken) {
    if (!bodyOrgId || bodyOrgId === resolvedOrgId) return;
    this.logger.warn(
      `[ORG_BODY_IGNORED] actor=${token?.email ?? '-'} sent orgId='${bodyOrgId}' in the body; serving '${resolvedOrgId ?? '-'}' from the validated request context.`,
    );
  }

  private async pipeSse(events: AsyncGenerator<LocalAgentStreamEvent>, res: FastifyReply) {
    try {
      for await (const event of events) {
        res.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      res.raw.write('data: [DONE]\n\n');
    } catch (error) {
      console.error('Local agent stream error:', error);
      res.raw.write(`data: ${JSON.stringify({ type: 'error', error: error?.message ?? 'Stream error occurred' })}\n\n`);
    } finally {
      res.raw.end();
    }
  }

  /** Emits what the server decided to inject before the engine starts talking. */
  private async *withPreamble(
    preamble: LocalAgentStreamEvent[],
    events: AsyncGenerator<LocalAgentStreamEvent>,
  ): AsyncGenerator<LocalAgentStreamEvent> {
    for (const event of preamble) yield event;
    yield* events;
  }
}
