import { Body, Controller, Get, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppToken, DecodedToken } from '@dataclouder/nest-auth';
import { OrgId } from '../common/org-id.decorator';
import { ProjectAuthGuard } from '../user/project-auth.guard';
import { AgenticHeartbeatService } from './agentic-heartbeat.service';
import { IAgenticHeartbeat } from '../agentic-profile/models/agentic-profile.models';

@ApiTags('agentic-heartbeat')
@Controller('api/agentic-profile/:id/heartbeat')
export class AgenticHeartbeatController {
  constructor(private readonly heartbeatService: AgenticHeartbeatService) {}

  private resolveOrgId(orgId?: string, token?: AppToken): string | undefined {
    return orgId || token?.userId || (token as any)?.id || (token as any)?.uid;
  }

  @Put()
  @ApiOperation({ summary: 'Update the heartbeat (cron) config of an agentic profile and reschedule it' })
  @ApiResponse({ status: 200, description: 'Heartbeat config saved and cron rescheduled.' })
  @UseGuards(ProjectAuthGuard)
  async updateHeartbeat(
    @Param('id') id: string,
    @Body() config: IAgenticHeartbeat,
    @OrgId() orgId?: string,
    @DecodedToken() token?: AppToken,
  ): Promise<IAgenticHeartbeat> {
    return this.heartbeatService.updateHeartbeatConfig(id, this.resolveOrgId(orgId, token), config);
  }

  @Post('run')
  @ApiOperation({ summary: 'Wake the agent now (manual heartbeat run, executes in background)' })
  @ApiResponse({ status: 201, description: 'Run started; returns the run id.' })
  @UseGuards(ProjectAuthGuard)
  async runNow(
    @Param('id') id: string,
    @OrgId() orgId?: string,
    @DecodedToken() token?: AppToken,
  ): Promise<{ runId: string }> {
    return this.heartbeatService.triggerNow(id, this.resolveOrgId(orgId, token));
  }

  @Get('runs')
  @ApiOperation({ summary: 'List the latest heartbeat runs of an agentic profile' })
  @UseGuards(ProjectAuthGuard)
  async listRuns(
    @Param('id') id: string,
    @OrgId() orgId?: string,
    @DecodedToken() token?: AppToken,
  ) {
    return this.heartbeatService.listRuns(id, this.resolveOrgId(orgId, token));
  }

  @Get('runs/:runId/live')
  @ApiOperation({ summary: 'SSE stream of a heartbeat run in real time (replays buffered events, then follows until finish)' })
  @UseGuards(ProjectAuthGuard)
  async streamRunLive(@Param('runId') runId: string, @Res() res: FastifyReply) {
    res.raw.setHeader('Content-Type', 'text/event-stream');
    res.raw.setHeader('Cache-Control', 'no-cache');
    res.raw.setHeader('Connection', 'keep-alive');
    res.raw.setHeader('Access-Control-Allow-Origin', '*');
    try {
      for await (const event of this.heartbeatService.streamRunLive(runId)) {
        res.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      res.raw.write('data: [DONE]\n\n');
    } catch (error) {
      res.raw.write(`data: ${JSON.stringify({ type: 'error', message: error?.message ?? 'Stream error' })}\n\n`);
    } finally {
      res.raw.end();
    }
  }

  @Get('runs/:runId')
  @ApiOperation({ summary: 'Get one heartbeat run with its full output' })
  @UseGuards(ProjectAuthGuard)
  async getRun(
    @Param('runId') runId: string,
    @OrgId() orgId?: string,
    @DecodedToken() token?: AppToken,
  ) {
    return this.heartbeatService.getRun(runId, this.resolveOrgId(orgId, token));
  }
}

@ApiTags('agentic-heartbeat')
@Controller('api/agentic-profile/heartbeats')
export class AgenticHeartbeatGlobalController {
  constructor(private readonly heartbeatService: AgenticHeartbeatService) {}

  @Get('live-stream')
  @ApiOperation({ summary: 'Global SSE stream of heartbeat activity for the active organization' })
  @UseGuards(ProjectAuthGuard)
  async streamGlobal(
    @Req() request: any,
    @Res() res: FastifyReply,
    @OrgId() orgId?: string,
    @DecodedToken() token?: AppToken,
  ) {
    const resolvedOrgId = orgId || token?.userId || (token as any)?.id || (token as any)?.uid;
    if (!resolvedOrgId) throw new Error('Organization context is required for the global heartbeat stream.');
    res.raw.setHeader('Content-Type', 'text/event-stream');
    res.raw.setHeader('Cache-Control', 'no-cache');
    res.raw.setHeader('Connection', 'keep-alive');
    // This endpoint writes to the raw Fastify response, so expose CORS here too.
    const requestOrigin = request.headers?.origin;
    res.raw.setHeader('Access-Control-Allow-Origin', requestOrigin || '*');
    res.raw.setHeader('Vary', 'Origin');
    res.raw.flushHeaders();
    res.raw.write(': connected\n\n');
    const abort = new AbortController();
    request.raw.on('close', () => abort.abort());
    try {
      for await (const event of this.heartbeatService.streamGlobalLive(resolvedOrgId, abort.signal)) {
        res.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } finally {
      if (!res.raw.writableEnded) res.raw.end();
    }
  }
}
