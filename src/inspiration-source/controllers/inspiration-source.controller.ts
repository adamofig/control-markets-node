import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InspirationSourceService } from '../services/inspiration-source.service';
import { EntityMongoController } from '@dataclouder/nest-mongo';
import { InspirationSourceDocument } from '../schemas/inspiration-source.schema';

@ApiTags('inspiration-source')
@Controller('api/inspiration-source')
export class InspirationSourceController extends EntityMongoController<InspirationSourceDocument> {
  constructor(private readonly inspirationSourceService: InspirationSourceService) {
    super(inspirationSourceService);
  }
}
