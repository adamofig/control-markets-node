import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RecentResourceEntity, RecentResourceDocument } from '../schemas/recent-resource.schema';
import { MongoService, EntityCommunicationService } from '@dataclouder/nest-mongo';
import { IRecentResource, TrackResourceDto } from '../models/recent-resources.models';

const MAX_RECENTS = 20;

@Injectable()
export class RecentResourcesService extends EntityCommunicationService<RecentResourceDocument> {
  constructor(
    @InjectModel(RecentResourceEntity.name)
    private recentResourceModel: Model<RecentResourceDocument>,
    mongoService: MongoService,
  ) {
    super(recentResourceModel, mongoService);
  }

  async trackResource(userId: string, dto: TrackResourceDto): Promise<RecentResourceDocument> {
    const upserted = await this.recentResourceModel
      .findOneAndUpdate(
        { userId, resourceId: dto.resourceId },
        {
          $set: {
            collection: dto.collection,
            name: dto.name,
            accessedAt: new Date(),
          },
          $setOnInsert: {
            userId,
            resourceId: dto.resourceId,
          },
        },
        { upsert: true, new: true },
      )
      .lean()
      .exec();

    const allForUser = await this.recentResourceModel.find({ userId }).sort({ accessedAt: -1 }).select('_id').lean().exec();

    if (allForUser.length > MAX_RECENTS) {
      const idsToDelete = allForUser.slice(MAX_RECENTS).map((doc) => doc._id);
      await this.recentResourceModel.deleteMany({ _id: { $in: idsToDelete } }).exec();
    }

    return upserted as RecentResourceDocument;
  }

  async getRecentForUser(userId: string, limit: number = 5): Promise<IRecentResource[]> {
    return this.recentResourceModel.find({ userId }).sort({ accessedAt: -1 }).limit(limit).lean().exec();
  }
}
