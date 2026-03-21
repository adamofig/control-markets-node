import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SocialMediaTrackerService } from '../services/social-media-tracker.service';

import { EntityMongoController } from '@dataclouder/nest-mongo';
import { SocialMediaTrackerDocument } from '../schemas/social-media-tracker.schema';

@ApiTags('Social Media Tracker')
@Controller('api/social-media-tracker') // NOT ENDPOINT Father will tell
export class SocialMediaTrackerController extends EntityMongoController<SocialMediaTrackerDocument> {
  constructor(private readonly socialMediaTrackerService: SocialMediaTrackerService) {
    super(socialMediaTrackerService);
  }
}
