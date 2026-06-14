import { Controller, Post, Param, UseGuards, Body, Res, Sse, MessageEvent } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { VideoSceneService } from '../services/video-scene.service';
import { VideoSceneEventsService } from '../services/video-scene-events.service';
import { EntityController } from '@dataclouder/nest-mongo';
import { VideoSceneDocument } from '../schemas/video-scene.schema';
import { AppToken, AuthGuard, DecodedToken } from '@dataclouder/nest-auth';
import { OrgId } from '../../common/org-id.decorator';
import { FastifyReply } from 'fastify';
import { Observable } from 'rxjs';

@ApiTags('video-scene')
@Controller('api/video-scene')
export class VideoSceneController extends EntityController<VideoSceneDocument> {
  constructor(
    private readonly videoSceneService: VideoSceneService,
    private readonly videoSceneEventsService: VideoSceneEventsService,
  ) {
    super(videoSceneService);
  }

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

  @Post('render-progress')
  @ApiOperation({ summary: 'Callback endpoint to receive rendering progress updates from control-render microservice' })
  async renderProgress(
    @Body() body: { sceneId: string; progress: number; stage: string; renderedFrames: number; encodedFrames: number }
  ): Promise<any> {
    this.videoSceneService.emitProgress(body.sceneId, body);
    return { ok: true };
  }

  @Post('render-download')
  @UseGuards(AuthGuard)
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
  @UseGuards(AuthGuard)
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
