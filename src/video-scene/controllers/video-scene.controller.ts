import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VideoSceneService } from '../services/video-scene.service';
import { EntityController } from '@dataclouder/nest-mongo';
import { VideoSceneDocument } from '../schemas/video-scene.schema';

@ApiTags('video-scene')
@Controller('api/video-scene')
export class VideoSceneController extends EntityController<VideoSceneDocument> {
  constructor(private readonly videoSceneService: VideoSceneService) {
    super(videoSceneService);
  }
}
