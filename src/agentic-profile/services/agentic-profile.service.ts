import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EntityCommunicationService, MongoService } from '@dataclouder/nest-mongo';
import { AgenticProfileDocument, AgenticProfileEntity } from '../schemas/agentic-profile.schema';

@Injectable()
export class AgenticProfileService extends EntityCommunicationService<AgenticProfileDocument> {
  constructor(
    @InjectModel(AgenticProfileEntity.name)
    agenticProfileModel: Model<AgenticProfileDocument>,
    mongoService: MongoService,
  ) {
    super(agenticProfileModel, mongoService);
  }
}
