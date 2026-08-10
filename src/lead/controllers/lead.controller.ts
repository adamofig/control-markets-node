import { Controller, UseGuards } from '@nestjs/common';
import { AppGuard } from '@dataclouder/nest-core';
import { ProjectAuthGuard } from 'src/user/project-auth.guard';
import { ApiTags } from '@nestjs/swagger';
import { LeadService } from '../services/lead.service';

import { EntityController } from '@dataclouder/nest-mongo';
import { LeadDocument } from '../schemas/lead.schema';

@ApiTags('lead')
@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/lead') // NOT ENDPOINT Father will tell
export class LeadController extends EntityController<LeadDocument> {
  constructor(private readonly leadService: LeadService) {
    super(leadService);
  }
}
