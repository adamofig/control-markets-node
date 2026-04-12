import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentSourceEntity, AgentSourceDocument } from '../schemas/agent-sources.schema';
import { IAgentSource } from '../models/classes';

import { YouTubeService } from '../../youtube/functions';
import { EntityCommunicationService, MongoService } from '@dataclouder/nest-mongo';
import { CloudStorageService } from '@dataclouder/nest-storage';

@Injectable()
export class AgentSourcesService extends EntityCommunicationService<AgentSourceDocument> {
  constructor(
    @InjectModel(AgentSourceEntity.name)
    sourceAgentModel: Model<AgentSourceDocument>,
    mongoService: MongoService,
    private cloudStorageService: CloudStorageService
  ) {
    super(sourceAgentModel, mongoService);
  }

  async findOne(id: string, projection: any = {}): Promise<AgentSourceDocument> {
    return this.genericModel.findOne({ id }, projection).lean().exec();
  }

  async findManyByIds(ids: string[]): Promise<AgentSourceDocument[]> {
    return this.genericModel.find({ id: { $in: ids } }).exec();
  }

  async save(source: IAgentSource): Promise<AgentSourceDocument> {
    if (source.id) {
      return this.update(source.id, source);
    } else {
      const sourceEntity = new this.genericModel(source);
      return sourceEntity.save();
    }
  }

  async update(id: string, source: IAgentSource): Promise<AgentSourceDocument> {
    return this.genericModel.findOneAndUpdate({ id }, source, { new: true }).exec();
  }

  async partialUpdate(id: string, partialUpdates: Partial<AgentSourceDocument>): Promise<AgentSourceDocument> {
    return await this.genericModel.findByIdAndUpdate(id, { $set: partialUpdates }, { new: true }).exec();
  }

  async partialUpdateFlattened(id: string, partialUpdates: Partial<AgentSourceDocument>): Promise<AgentSourceDocument> {
    // Convert nested objects to dot notation eg. { "video.captions.remotion": captions.captions }
    const flattenedUpdates = this.flattenObject(partialUpdates);
    return await this.genericModel.findByIdAndUpdate(id, { $set: flattenedUpdates }, { new: true }).exec();
  }

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

  async delete(id: string): Promise<AgentSourceDocument> {
    console.log('Deleting source', id);
    const source = await this.genericModel.findOne({ id }).lean().exec();
    console.log('Source', source);
    const pathsObjects = this.findAllObjectsWithPaths(source);
    console.log('Removing items from storage: ', pathsObjects.length);
    const promises = pathsObjects.map(obj => this.cloudStorageService.deleteStorageFile(obj.bucket, obj.path));
    try {
      await Promise.all(promises);
    } catch (error) {
      console.error('Error removing items from storage: ', error);
    }
    return this.genericModel.findOneAndDelete({ id }).exec();
  }

  async getYoutubeTranscript(url: string): Promise<any> {
    const youtubeService = new YouTubeService(process.env.YOUTUBE_API_KEY);
    const transcript = await youtubeService.getVideoTranscript(url);
    return transcript;
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
