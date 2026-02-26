import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SocialMediaTrackerEntity, SocialMediaTrackerDocument } from '../schemas/social-media-tracker.schema';
import { MongoService } from '@dataclouder/nest-mongo';
import { CloudStorageService } from '@dataclouder/nest-storage';
import { EntityCommunicationService } from '@dataclouder/nest-mongo';

/**
 * Service for managing socialMediaTracker entities in the database
 * Provides CRUD operations and query capabilities for SocialMediaTrackerEntity objects
 */
/**
 * Service for managing socialMediaTracker entities in the database
 * Provides CRUD operations and query capabilities for SocialMediaTrackerEntity objects
 * @description
 * This service provides methods for creating, retrieving, updating, and deleting socialMediaTracker entities
 * It also provides a query method that takes a filters configuration object and returns a promise resolving to a query response containing results and metadata
 */
@Injectable()
export class SocialMediaTrackerService extends EntityCommunicationService<SocialMediaTrackerDocument> {
  constructor(
    @InjectModel(SocialMediaTrackerEntity.name)
    socialMediaTrackerModel: Model<SocialMediaTrackerDocument>,
    mongoService: MongoService
  ) {
    super(socialMediaTrackerModel, mongoService);
  }
}
