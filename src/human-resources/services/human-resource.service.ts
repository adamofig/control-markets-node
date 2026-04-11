import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EntityCommunicationService, MongoService } from '@dataclouder/nest-mongo';
import { HumanResourceDocument, HumanResourceEntity } from '../schemas/human-resource.schema';

@Injectable()
export class HumanResourceService extends EntityCommunicationService<HumanResourceDocument> {
  constructor(
    @InjectModel(HumanResourceEntity.name)
    humanResourceModel: Model<HumanResourceDocument>,
    mongoService: MongoService,
  ) {
    super(humanResourceModel, mongoService);
  }
}
