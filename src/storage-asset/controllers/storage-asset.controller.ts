import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { StorageAssetService } from '../services/storage-asset.service';

import { EntityController } from '@dataclouder/nest-mongo';
import { StorageAssetDocument } from '../schemas/storage-asset.schema';

@ApiTags('StorageAsset')
@Controller('api/storage-asset') // NOT ENDPOINT Father will tell
export class StorageAssetController extends EntityController<StorageAssetDocument> {
  constructor(private readonly StorageAssetService: StorageAssetService) {
    super(StorageAssetService);
  }
}
