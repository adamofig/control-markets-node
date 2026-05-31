import { Controller, Post, Param, UseGuards, Body, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { VideoSceneService } from '../services/video-scene.service';
import { EntityController } from '@dataclouder/nest-mongo';
import { VideoSceneDocument } from '../schemas/video-scene.schema';
import { AppToken, AuthGuard, DecodedToken } from '@dataclouder/nest-auth';
import { OrgId } from '../../common/org-id.decorator';
import { FastifyReply } from 'fastify';

@ApiTags('video-scene')
@Controller('api/video-scene')
export class VideoSceneController extends EntityController<VideoSceneDocument> {
  constructor(private readonly videoSceneService: VideoSceneService) {
    super(videoSceneService);
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
