import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SocialMediaTrackerService } from '../services/social-media-tracker.service';

import { EntityMongoController } from '@dataclouder/nest-mongo';
import { OperationDto } from '@dataclouder/nest-mongo/dist/dto/operation.dto';
import { SocialMediaTrackerDocument } from '../schemas/social-media-tracker.schema';
import { AppToken, AuthGuard, DecodedToken } from '@dataclouder/nest-auth';

@ApiTags('Social Media Tracker')
@Controller('api/social-media-tracker')
export class SocialMediaTrackerController extends EntityMongoController<SocialMediaTrackerDocument> {
  constructor(private readonly socialMediaTrackerService: SocialMediaTrackerService) {
    super(socialMediaTrackerService);
  }

  @Post('operation')
  @UseGuards(AuthGuard)
  async executeOperation(@Body() operationDto: OperationDto, @DecodedToken() token: AppToken): Promise<any> {
    console.log('executeOperation dto:', JSON.stringify(operationDto, null, 2));
    const result = await super.executeOperation(operationDto, token);
    console.log('executeOperation result:', JSON.stringify(result, null, 2));
    return result;
  }
}
