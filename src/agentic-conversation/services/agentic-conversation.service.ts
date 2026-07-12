import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EntityCommunicationService, MongoService } from '@dataclouder/nest-mongo';
import { AgenticConversationDocument, AgenticConversationEntity } from '../schemas/agentic-conversation.schema';

@Injectable()
export class AgenticConversationService extends EntityCommunicationService<AgenticConversationDocument> {
  constructor(@InjectModel(AgenticConversationEntity.name) model: Model<AgenticConversationDocument>, mongoService: MongoService) {
    super(model, mongoService);
  }
}
