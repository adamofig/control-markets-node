import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EntityController } from '@dataclouder/nest-mongo';
import { HumanResourceDocument } from '../schemas/human-resource.schema';
import { HumanResourceService } from '../services/human-resource.service';

@ApiTags('human-resources')
@Controller('api/human-resources')
export class HumanResourceController extends EntityController<HumanResourceDocument> {
  constructor(private readonly humanResourceService: HumanResourceService) {
    super(humanResourceService);
  }
}
