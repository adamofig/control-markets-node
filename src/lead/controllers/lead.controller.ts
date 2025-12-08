import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LeadService } from '../services/lead.service';

import { EntityController } from '@dataclouder/nest-mongo';
import { LeadDocument } from '../schemas/lead.schema';

@ApiTags('lead')
@Controller('api/lead') // NOT ENDPOINT Father will tell
export class LeadController extends EntityController<LeadDocument> {
  constructor(private readonly leadService: LeadService) {
    super(leadService);
  }
}
