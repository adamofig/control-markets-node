import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentSourceEntity, AgentSourceDocument } from '../schemas/agent-sources.schema';
import { IAgentSource } from '../models/classes';

import { YouTubeService } from '../../youtube/functions';
import { FiltersConfig, IQueryResponse, MongoService } from '@dataclouder/nest-mongo';
import { CloudStorageService } from '@dataclouder/nest-storage';

@Injectable()
export class AgentSourcesService {
  constructor(
    @InjectModel(AgentSourceEntity.name)
    private sourceAgentModel: Model<AgentSourceDocument>,
    private mongoService: MongoService,
    private cloudStorageService: CloudStorageService
  ) {}

  async findAll(): Promise<AgentSourceEntity[]> {
    return this.sourceAgentModel.find().exec();
  }

  async findOne(id: string, projection: any = {}): Promise<AgentSourceEntity> {
    return this.sourceAgentModel.findOne({ id }, projection).lean().exec();
  }

  async findManyByIds(ids: string[]): Promise<AgentSourceEntity[]> {
    return this.sourceAgentModel.find({ id: { $in: ids } }).exec();
  }

  async save(source: IAgentSource): Promise<AgentSourceEntity> {
    if (source.id) {
      return this.update(source.id, source);
    } else {
      const sourceEntity = new this.sourceAgentModel(source);
      return sourceEntity.save();
    }
  }

  async update(id: string, source: IAgentSource): Promise<AgentSourceEntity> {
    return this.sourceAgentModel.findOneAndUpdate({ id }, source, { new: true }).exec();
  }

  async partialUpdate(id: string, partialUpdates: Partial<AgentSourceEntity>): Promise<AgentSourceEntity> {
    return await this.sourceAgentModel.findByIdAndUpdate(id, { $set: partialUpdates }, { new: true }).exec();
  }

  /**
   * Updates only the properties that are present in the update object
   * @param id The ID of the entity to update
   * @param partialUpdates Object containing only the properties to update
   * @returns The updated entity
   */
  async partialUpdateFlattened(id: string, partialUpdates: Partial<AgentSourceEntity>): Promise<AgentSourceEntity> {
    // Convert nested objects to dot notation eg. { "video.captions.remotion": captions.captions }
    const flattenedUpdates = this.flattenObject(partialUpdates);
    return await this.sourceAgentModel.findByIdAndUpdate(id, { $set: flattenedUpdates }, { new: true }).exec();
  }

  // Add this helper method to flatten nested objects
  private flattenObject(obj: any, prefix = ''): any {
    const flattened: any = {};

    for (const key in obj) {
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        const nested = this.flattenObject(obj[key], prefix + key + '.');
        Object.assign(flattened, nested);
      } else {
        flattened[prefix + key] = obj[key];
      }
    }

    return flattened;
  }

  async delete(id: string): Promise<AgentSourceEntity> {
    // Delete all filers in storage first.
    console.log('Deleting source', id);
    const source = await this.sourceAgentModel.findOne({ id }).lean().exec();
    console.log('Source', source);
    // replace by removeAllStorageFilesPresentInObject in cloud storage service
    const pathsObjects = this.findAllObjectsWithPaths(source);
    console.log('Removing items from storage: ', pathsObjects.length);
    const promises = pathsObjects.map(obj => this.cloudStorageService.deleteStorageFile(obj.bucket, obj.path));
    try {
      await Promise.all(promises);
    } catch (error) {
      console.error('Error removing items from storage: ', error);
    }
    return this.sourceAgentModel.findOneAndDelete({ id }).exec();
  }

  async getYoutubeTranscript(url: string): Promise<any> {
    const youtubeService = new YouTubeService(process.env.YOUTUBE_API_KEY);
    const transcript = await youtubeService.getVideoTranscript(url);
    return transcript;
  }

  async queryUsingFiltersConfig(filterConfig: FiltersConfig): Promise<IQueryResponse<AgentSourceEntity>> {
    return await this.mongoService.queryUsingFiltersConfig(filterConfig, this.sourceAgentModel);
  }

  /**
   * Recursively finds all objects that contain a 'path' property
   * @param obj The object to search through
   * @returns Array of objects that contain a path property
   */
  findAllObjectsWithPaths(obj: any): any[] {
    if (!obj) return [];

    const objectsWithPaths: any[] = [];

    const search = (current: any) => {
      if (!current || typeof current !== 'object') return;

      if (current.path && typeof current.path === 'string') {
        objectsWithPaths.push(current);
      }

      // Search arrays
      if (Array.isArray(current)) {
        current.forEach(item => search(item));
      } else {
        // Search object properties
        Object.values(current).forEach(value => search(value));
      }
    };

    search(obj);
    return objectsWithPaths;
  }
}
