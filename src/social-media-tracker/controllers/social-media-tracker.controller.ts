import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SocialMediaTrackerService } from '../services/social-media-tracker.service';

import { EntityMongoController } from '@dataclouder/nest-mongo';
import { OperationDto } from '@dataclouder/nest-mongo/dist/dto/operation.dto';
import { SocialMediaTrackerDocument } from '../schemas/social-media-tracker.schema';
import { AppToken, DecodedToken } from '@dataclouder/nest-auth';
import { AppGuard } from '@dataclouder/nest-core';
import { ProjectAuthGuard } from '../../user/project-auth.guard';

/** F10: class-level guard, replacing the Firebase-only `AuthGuard` that covered just `operation`. */
@ApiTags('Social Media Tracker')
@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/social-media-tracker')
export class SocialMediaTrackerController extends EntityMongoController<SocialMediaTrackerDocument> {
  constructor(private readonly socialMediaTrackerService: SocialMediaTrackerService) {
    super(socialMediaTrackerService);
  }

  @Post('operation')
  async executeOperation(@Body() operationDto: OperationDto, @DecodedToken() token: AppToken): Promise<any> {
    console.log('executeOperation dto:', JSON.stringify(operationDto, null, 2));
    const result = await super.executeOperation(operationDto, token);
    console.log('executeOperation result:', JSON.stringify(result, null, 2));
    return result;
  }
}
