import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { StorageAssetEntity, StorageAssetDocument } from '../schemas/storage-asset.schema';
import { MongoService } from '@dataclouder/nest-mongo';
import { CloudStorageService } from '@dataclouder/nest-storage';
import { EntityCommunicationService } from '@dataclouder/nest-mongo';

/**
 * Service for managing StorageAsset entities in the database
 * Provides CRUD operations and query capabilities for StorageAssetEntity objects
 */
/**
 * Service for managing StorageAsset entities in the database
 * Provides CRUD operations and query capabilities for StorageAssetEntity objects
 * @description
 * This service provides methods for creating, retrieving, updating, and deleting StorageAsset entities
 * It also provides a query method that takes a filters configuration object and returns a promise resolving to a query response containing results and metadata
 */
@Injectable()
export class StorageAssetService extends EntityCommunicationService<StorageAssetDocument> {
  constructor(
    @InjectModel(StorageAssetEntity.name)
    StorageAssetModel: Model<StorageAssetDocument>,
    mongoService: MongoService
  ) {
    super(StorageAssetModel, mongoService);
  }
}
