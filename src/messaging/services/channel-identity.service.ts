import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EntityCommunicationService, MongoService } from '@dataclouder/nest-mongo';
import { ChannelIdentityDocument, ChannelIdentityEntity } from '../schemas/channel-identity.schema';

@Injectable()
export class ChannelIdentityService extends EntityCommunicationService<ChannelIdentityDocument> {
  constructor(
    @InjectModel(ChannelIdentityEntity.name)
    channelIdentityModel: Model<ChannelIdentityDocument>,
    mongoService: MongoService,
  ) {
    super(channelIdentityModel, mongoService);
  }
}
