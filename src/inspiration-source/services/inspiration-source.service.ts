import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InspirationSourceEntity, InspirationSourceDocument } from '../schemas/inspiration-source.schema';
import { MongoService, EntityCommunicationService } from '@dataclouder/nest-mongo';

@Injectable()
export class InspirationSourceService extends EntityCommunicationService<InspirationSourceDocument> {
  constructor(
    @InjectModel(InspirationSourceEntity.name)
    inspirationSourceModel: Model<InspirationSourceDocument>,
    mongoService: MongoService,
  ) {
    super(inspirationSourceModel, mongoService);
  }
}
