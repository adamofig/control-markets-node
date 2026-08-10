import { Controller, Post, Param, UseGuards, Body, Res, Sse, MessageEvent } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { VideoSceneService } from '../services/video-scene.service';
import { VideoSceneEventsService } from '../services/video-scene-events.service';
import { EntityController } from '@dataclouder/nest-mongo';
import { VideoSceneDocument } from '../schemas/video-scene.schema';
import { AppToken, DecodedToken } from '@dataclouder/nest-auth';
import { AppGuard } from '@dataclouder/nest-core';
import { ProjectAuthGuard } from 'src/user/project-auth.guard';
import { Public } from 'src/auth/public.decorator';
import { OrgId } from '../../common/org-id.decorator';
import { FastifyReply } from 'fastify';
import { Observable } from 'rxjs';

/**
 * F10: class-level guard. The render routes were guarded with `AuthGuard` (Firebase only); they now
 * inherit `ProjectAuthGuard` from the class, which also accepts PATs — the same auth the rest of the
 * platform uses — and the inherited CRUD routes stop being anonymous.
 */
@ApiTags('video-scene')
@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/video-scene')
export class VideoSceneController extends EntityController<VideoSceneDocument> {
  constructor(
    private readonly videoSceneService: VideoSceneService,
    private readonly videoSceneEventsService: VideoSceneEventsService,
  ) {
    super(videoSceneService);
  }

  /** TODO(F13): browser `EventSource` cannot send `Authorization` — see the twin case in `creative-flowboard`. */
  @Public('TODO(F13): browser EventSource cannot send Authorization. Read-only stream, needs a known scene id.')
  @Sse('subscribe/:id')
  subscribe(@Param('id') id: string): Observable<MessageEvent> {
    return new Observable((observer) => {
      const handler = (data) => {
        observer.next({ data });
      };
      this.videoSceneEventsService.subscribe(id, handler);
      // Clean up when client disconnects
      return () => this.videoSceneEventsService.unsubscribe(id, handler);
    });
  }

  /**
   * TODO(F17): `control-render` posts here with **no credentials at all** ([`server.ts`], the
   * `PROGRESS_CALLBACK_URL` fetch), so guarding it today would silently kill every render progress
   * bar. Closing it means giving that microservice a credential (the `cm_master_*` token is the
   * obvious candidate) — a cross-repo change, not a decorator.
   *
   * Exposure while it lasts: an anonymous caller can push a fake progress number onto the SSE
   * stream of a scene id it already knows. It writes nothing to the database.
   */
  @Public('TODO(F17): control-render posts this callback without credentials. Emits an SSE progress event, persists nothing.')
  @Post('render-progress')
  @ApiOperation({ summary: 'Callback endpoint to receive rendering progress updates from control-render microservice' })
  async renderProgress(
    @Body() body: { sceneId: string; progress: number; stage: string; renderedFrames: number; encodedFrames: number }
  ): Promise<any> {
    this.videoSceneService.emitProgress(body.sceneId, body);
    return { ok: true };
  }

  @Post('render-download')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Render video scene and download it directly' })
  async renderDownload(
    @Body() body: { scene: any },
    @Res() res: FastifyReply
  ): Promise<void> {
    try {
      const fileBuffer = await this.videoSceneService.renderSceneOnly(body.scene);
      res.header('Content-Type', 'video/mp4');
      res.header('Content-Disposition', `attachment; filename="render-${Date.now()}.mp4"`);
      res.send(fileBuffer);
    } catch (error: any) {
      res.status(500).send({
        error: 'Failed to render scene preview',
        details: error.message,
      });
    }
  }

  @Post(':id/render')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Render video scene' })
  async render(
    @Param('id') id: string,
    @OrgId() orgId: string | undefined,
    @DecodedToken() token: AppToken
  ): Promise<any> {
    const auditable = {
      createdBy: token?.email || 'system',
      createdAt: new Date(),
      updatedBy: token?.email || 'system',
      updatedAt: new Date(),
    };
    return this.videoSceneService.renderScene(id, orgId, auditable);
  }
}
