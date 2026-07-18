import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WorkspaceService } from '../services/workspace.service';
import { EntityMongoController } from '@dataclouder/nest-mongo';
import { WorkspaceDocument } from '../schemas/workspace.schema';

@ApiTags('workspaces')
@Controller('api/workspaces')
export class WorkspaceController extends EntityMongoController<WorkspaceDocument> {
  constructor(private readonly workspaceService: WorkspaceService) {
    super(workspaceService);
  }
}
