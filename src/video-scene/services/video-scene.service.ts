import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VideoSceneEntity, VideoSceneDocument } from '../schemas/video-scene.schema';
import { MongoService, EntityCommunicationService } from '@dataclouder/nest-mongo';

@Injectable()
export class VideoSceneService extends EntityCommunicationService<VideoSceneDocument> {
  constructor(
    @InjectModel(VideoSceneEntity.name)
    videoSceneModel: Model<VideoSceneDocument>,
    mongoService: MongoService,
  ) {
    super(videoSceneModel, mongoService);
  }
}
