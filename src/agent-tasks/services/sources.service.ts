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

  /**
   * Skill sources of one organization, projected without `content` — the catalog only renders labels,
   * and a skill body is a whole `.md` file. Matches the current `kind: 'skill'` contract as well as the
   * legacy `tag: 'rule'` rows written before `kind` existed, so skills synced earlier stay visible.
   */
  async findSkillsByOrg(orgId: string): Promise<SourceDocument[]> {
    return this.genericModel
      .find({ orgId, $or: [{ kind: 'skill' }, { tag: 'rule' }] }, { id: 1, name: 1, description: 1, sourceUrl: 1, updatedAt: 1 })
      .sort({ name: 1 })
      .lean()
      .exec() as unknown as Promise<SourceDocument[]>;
  }

  /**
   * Catalog rows for the `@` mention menu, scoped to one organization.
   *
   * Two things this method owes its caller:
   *
   * 1. **`orgId` is mandatory.** An empty one would build `{}` and hand back every tenant's sources.
   *    The guard is here, at the query, and not only at the controller.
   * 2. **`content` is never projected.** A row renders a name; a source body can be a whole YouTube
   *    transcript, and a catalog that ships them would cost more than the feature saves.
   *
   * `includeSynced` is off by default because this collection is shared with the wiki sync: every
   * agent's memories, skills and explorations live here too (they carry `relPath`/`workspaceId`).
   * Listing them unfiltered floods the menu with other agents' private notes, which is exactly what
   * the profile-linked catalog already decides for itself.
   */
  async searchForMentions(orgId: string, query: string, limit = 12, options: { includeSynced?: boolean } = {}): Promise<SourceDocument[]> {
    if (!orgId) return [];
    const filter: Record<string, any> = { orgId };
    if (!options.includeSynced) {
      filter.$and = [{ $or: [{ relPath: { $exists: false } }, { relPath: null }, { relPath: '' }] }];
    }
    const trimmed = (query ?? '').trim();
    if (trimmed) {
      const rx = new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { description: rx }];
    }

    return this.genericModel
      .find(filter, { id: 1, name: 1, description: 1, sourceUrl: 1, type: 1, tag: 1, kind: 1, relPath: 1, updatedAt: 1 })
      .sort(trimmed ? { name: 1 } : { updatedAt: -1 })
      .limit(Math.max(1, Math.min(limit, 50)))
      .lean()
      .exec() as unknown as Promise<SourceDocument[]>;
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
