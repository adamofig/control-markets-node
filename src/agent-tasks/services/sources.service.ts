import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SourceEntity, SourceDocument } from '../schemas/sources.schema';
import { ISource } from '../models/classes';

import { YouTubeService } from '../../youtube/functions';
import { EntityCommunicationService, MongoService } from '@dataclouder/nest-mongo';
import { CloudStorageService } from '@dataclouder/nest-storage';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { emitWikiChangeForOperation, WIKI_SOURCE_CHANGED } from '../../wiki-sync/wiki-sync.events';

@Injectable()
export class SourcesService extends EntityCommunicationService<SourceDocument> {
  constructor(
    @InjectModel(SourceEntity.name)
    sourceModel: Model<SourceDocument>,
    mongoService: MongoService,
    private cloudStorageService: CloudStorageService,
    private eventEmitter: EventEmitter2
  ) {
    super(sourceModel, mongoService);
  }

  /** Every generic write (UI CRUD, sync) flows through here — notify the wiki write-back */
  async executeOperation(operation: any): Promise<any> {
    const result = await super.executeOperation(operation);
    emitWikiChangeForOperation(this.eventEmitter, WIKI_SOURCE_CHANGED, operation, result);
    return result;
  }

  /** Sync-contract fields written by the wiki write-back itself — deliberately does NOT emit events */
  async updateSyncContract(id: string, fields: Partial<SourceEntity>): Promise<void> {
    await this.genericModel.updateOne({ id }, { $set: fields }).exec();
  }

  private emitChanged(source: any): void {
    const id = source?.id || source?._id?.toString();
    if (id) this.eventEmitter.emit(WIKI_SOURCE_CHANGED, { id });
  }

  async findOne(id: string, projection: any = {}): Promise<SourceDocument> {
    return this.genericModel.findOne({ id }, projection).lean().exec() as unknown as Promise<SourceDocument>;
  }

  async findManyByIds(ids: string[], orgId?: string): Promise<SourceDocument[]> {
    return this.genericModel.find({ id: { $in: ids }, ...(orgId ? { orgId } : {}) }).exec();
  }

  async save(source: ISource): Promise<SourceDocument> {
    if (source.id) {
      return this.update(source.id, source);
    } else {
      const sourceEntity = new this.genericModel(source);
      const saved = await sourceEntity.save();
      this.emitChanged(saved);
      return saved;
    }
  }

  async update(id: string, source: ISource): Promise<SourceDocument> {
    const updated = await this.genericModel.findOneAndUpdate({ id }, source, { new: true }).exec();
    this.emitChanged(updated || { id });
    return updated;
  }

  async partialUpdate(id: string, partialUpdates: Partial<SourceDocument>): Promise<SourceDocument> {
    const updated = await this.genericModel.findByIdAndUpdate(id, { $set: partialUpdates }, { new: true }).exec();
    this.emitChanged(updated || { id });
    return updated;
  }

  async partialUpdateFlattened(id: string, partialUpdates: Partial<SourceDocument>): Promise<SourceDocument> {
    // Convert nested objects to dot notation eg. { "video.captions.remotion": captions.captions }
    const flattenedUpdates = this.flattenObject(partialUpdates);
    const updated = await this.genericModel.findByIdAndUpdate(id, { $set: flattenedUpdates }, { new: true }).exec();
    this.emitChanged(updated || { id });
    return updated;
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

  async delete(id: string): Promise<SourceDocument> {
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
