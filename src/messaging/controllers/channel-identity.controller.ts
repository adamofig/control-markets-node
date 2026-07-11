import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EntityMongoController } from '@dataclouder/nest-mongo';
import { ChannelIdentityDocument } from '../schemas/channel-identity.schema';
import { ChannelIdentityService } from '../services/channel-identity.service';

@ApiTags('channel-identity')
@Controller('api/channel-identity')
export class ChannelIdentityController extends EntityMongoController<ChannelIdentityDocument> {
  constructor(private readonly channelIdentityService: ChannelIdentityService) {
    super(channelIdentityService);
  }
}
