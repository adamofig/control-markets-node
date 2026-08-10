import { Controller, UseGuards } from '@nestjs/common';
import { AppGuard } from '@dataclouder/nest-core';
import { ProjectAuthGuard } from 'src/user/project-auth.guard';
import { ApiTags } from '@nestjs/swagger';
import {  EntityMongoController } from '@dataclouder/nest-mongo';
import { HumanResourceDocument } from '../schemas/human-resource.schema';
import { HumanResourceService } from '../services/human-resource.service';

@ApiTags('human-resources')
@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/human-resources')
export class HumanResourceController extends EntityMongoController<HumanResourceDocument> {
  constructor(private readonly humanResourceService: HumanResourceService) {
    super(humanResourceService);
  }
}
