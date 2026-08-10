import { Controller, UseGuards } from '@nestjs/common';
import { AppGuard } from '@dataclouder/nest-core';
import { ProjectAuthGuard } from 'src/user/project-auth.guard';
import { ApiTags } from '@nestjs/swagger';
import { WorkspaceService } from '../services/workspace.service';
import { EntityMongoController } from '@dataclouder/nest-mongo';
import { WorkspaceDocument } from '../schemas/workspace.schema';

@ApiTags('workspaces')
@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/workspaces')
export class WorkspaceController extends EntityMongoController<WorkspaceDocument> {
  constructor(private readonly workspaceService: WorkspaceService) {
    super(workspaceService);
  }
}
