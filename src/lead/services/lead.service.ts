import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LeadEntity, LeadDocument } from '../schemas/lead.schema';
import { MongoService } from '@dataclouder/nest-mongo';
import { CloudStorageService } from '@dataclouder/nest-storage';
import { EntityCommunicationService } from '@dataclouder/nest-mongo';

/**
 * Service for managing lead entities in the database
 * Provides CRUD operations and query capabilities for LeadEntity objects
 */
/**
 * Service for managing lead entities in the database
 * Provides CRUD operations and query capabilities for LeadEntity objects
 * @description
 * This service provides methods for creating, retrieving, updating, and deleting lead entities
 * It also provides a query method that takes a filters configuration object and returns a promise resolving to a query response containing results and metadata
 */
@Injectable()
export class LeadService extends EntityCommunicationService<LeadDocument> {
  constructor(
    @InjectModel(LeadEntity.name)
    leadModel: Model<LeadDocument>,
    mongoService: MongoService
  ) {
    super(leadModel, mongoService);
  }
}
