import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@dataclouder/nest-auth';
import { StorageAssetCaptionsService } from './storage-asset-captions.service';

@Controller('api/storage-asset')
@UseGuards(AuthGuard)
export class StorageAssetCaptionsController {
  constructor(private readonly captionsService: StorageAssetCaptionsService) {}

  @Post(':id/extract-captions')
  extractCaptions(@Param('id') id: string) {
    return this.captionsService.extractCaptions(id);
  }
}
