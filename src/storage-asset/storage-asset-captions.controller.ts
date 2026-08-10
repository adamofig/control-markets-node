import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AppGuard } from '@dataclouder/nest-core';
import { ProjectAuthGuard } from '../user/project-auth.guard';
import { StorageAssetCaptionsService } from './storage-asset-captions.service';

/** F10: was already closed, but with the Firebase-only `AuthGuard`. Aligned with its sibling controller so a PAT works here too. */
@Controller('api/storage-asset')
@UseGuards(AppGuard, ProjectAuthGuard)
export class StorageAssetCaptionsController {
  constructor(private readonly captionsService: StorageAssetCaptionsService) {}

  @Post(':id/extract-captions')
  extractCaptions(@Param('id') id: string) {
    return this.captionsService.extractCaptions(id);
  }
}
