import { Controller, UseGuards } from '@nestjs/common';
import { AppGuard } from '@dataclouder/nest-core';
import { ProjectAuthGuard } from 'src/user/project-auth.guard';
import { ApiTags } from '@nestjs/swagger';
import { EntityMongoController } from '@dataclouder/nest-mongo';
import { ChannelIdentityDocument } from '../schemas/channel-identity.schema';
import { ChannelIdentityService } from '../services/channel-identity.service';

@ApiTags('channel-identity')
@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/channel-identity')
export class ChannelIdentityController extends EntityMongoController<ChannelIdentityDocument> {
  constructor(private readonly channelIdentityService: ChannelIdentityService) {
    super(channelIdentityService);
  }
}
