import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { VideoGeneratorEntity, VideoGeneratorDocument } from '../schemas/video-project.entity';
import {
  CreateVideoGeneratorDto,
  ISyncSceneReferencesResult,
  IVideoProjectGenerator,
  UpdateVideoGeneratorDto,
} from '../models/video-project.models';
import { FiltersConfig, flattenObject, IQueryResponse, MongoService } from '@dataclouder/nest-mongo';
import { ObjectId } from 'mongodb';
import { SourcesService } from '../../agent-tasks/services/sources.service';
import { AgentCardService } from '@dataclouder/nest-agent-cards';
import { EntityCommunicationService } from '@dataclouder/nest-mongo';
import { CloudStorageService } from '@dataclouder/nest-storage';
import { AppException } from '@dataclouder/nest-core';
import { VideoSceneEntity, VideoSceneDocument } from '../../video-scene/schemas/video-scene.schema';
import { VIDEO_SCENE_SUMMARY_PROJECTION, toVideoSceneSummary } from './video-scene-summary.mapper';
@Injectable()
export class VideoGeneratorService extends EntityCommunicationService<VideoGeneratorDocument> {
  constructor(
    @InjectModel(VideoGeneratorEntity.name)
    protected videoGeneratorModel: Model<VideoGeneratorDocument>,
    @InjectModel(VideoSceneEntity.name)
    protected videoSceneModel: Model<VideoSceneDocument>,
    protected mongoService: MongoService,
    private sourceService: SourcesService,
    private agentCardService: AgentCardService,
    protected cloudStorageService: CloudStorageService
  ) {
    super(videoGeneratorModel, mongoService);
  }

  /**
   * `videoScene` is a hard relation: the project stores only ids and their order.
   * Single-document reads get the linked scenes resolved here so the project view
   * always reflects the current state of each scene (status, audio, media).
   *
   * Deliberately skipped for `find` — the project list does not render scene data
   * and hydrating there would mean one extra query per project.
   */
  override async executeOperation(operation: any): Promise<any> {
    // Reads return hydrated summaries; make sure a round-tripped project never
    // persists them back into the document. The controller may have already moved
    // part of the payload under `$set`, so both levels are sanitized.
    const isWrite = ['create', 'updateOne', 'updateMany', 'partialUpdate'].includes(operation?.action);
    if (isWrite && operation.payload) {
      operation.payload = this.stripSceneSummaries(operation.payload);
      if (operation.payload.$set) {
        operation.payload.$set = this.stripSceneSummaries(operation.payload.$set);
      }
    }

    const result = await super.executeOperation(operation);
    if (operation?.action !== 'findOne' || !result) {
      return result;
    }
    return this.hydrateVideoScenes(result, operation?.query?.orgId);
  }

  /**
   * Reduces any `videoScene` array in a write payload back to bare `{ id }`
   * references. Only the link and the order are persisted.
   */
  private stripSceneSummaries<T extends Record<string, any>>(payload: T): T {
    if (!payload || !Array.isArray(payload.videoScene)) {
      return payload;
    }
    return {
      ...payload,
      videoScene: payload.videoScene.filter(ref => ref?.id).map(ref => ({ id: ref.id })),
    };
  }

  /**
   * Replaces `videoScene` refs with freshly read `IVideoSceneSummary` objects,
   * preserving the order stored in the project.
   */
  async hydrateVideoScenes(project: any, orgId?: string): Promise<any> {
    const plain = typeof project?.toObject === 'function' ? project.toObject() : project;
    const refs = plain?.videoScene;
    if (!Array.isArray(refs) || refs.length === 0) {
      return plain;
    }

    const ids = refs.map(ref => ref?.id).filter((id): id is string => !!id && isValidObjectId(id));
    if (ids.length === 0) {
      return { ...plain, videoScene: refs.map(ref => toVideoSceneSummary(ref?.id)) };
    }

    const match: any = { _id: { $in: ids.map(id => new ObjectId(id)) } };
    if (orgId) {
      match.orgId = orgId;
    }

    const scenes = await this.videoSceneModel.aggregate([{ $match: match }, { $project: VIDEO_SCENE_SUMMARY_PROJECTION }]).exec();
    const byId = new Map(scenes.map(scene => [String(scene._id), scene]));

    return {
      ...plain,
      videoScene: refs.map(ref => toVideoSceneSummary(ref?.id, byId.get(String(ref?.id)))),
    };
  }


  /**
   * Propaga la tarjeta de agente y las referencias de imagen del proyecto a **todas** sus escenas.
   *
   * Las escenas copian estos datos una sola vez, cuando se crean (`generateScenesWithAI`), así que
   * editar el proyecto después las dejaba desactualizadas. Esto las sobreescribe a mano.
   *
   * Es un **overwrite**, no un merge: si el proyecto ya no tiene tarjeta o referencias, se quitan
   * también de las escenas — así el proyecto es siempre la fuente de verdad. Se copia el mismo
   * snapshot (`imageRefs` apunta a los `storage_assets` que ya existen), no se crean assets nuevos.
   */
  async syncReferencesToScenes(projectId: string, orgId?: string): Promise<ISyncSceneReferencesResult> {
    const query: any = { _id: projectId };
    if (orgId) {
      query.orgId = orgId;
    }

    const project = await this.videoGeneratorModel.findOne(query, { videoScene: 1, agentCard: 1, imageRefs: 1 }).lean().exec();
    if (!project) {
      throw new AppException({ error_message: 'Video project not found or access denied', statusCode: 404 });
    }

    const agentCard = (project as any).agentCard || null;
    const imageRefs: any[] = Array.isArray((project as any).imageRefs) ? (project as any).imageRefs : [];
    const ids = ((project as any).videoScene ?? [])
      .map((ref: any) => ref?.id)
      .filter((id: any): id is string => !!id && isValidObjectId(id));

    const result: ISyncSceneReferencesResult = {
      total: ids.length,
      matched: 0,
      updated: 0,
      agentCardId: agentCard?.id ?? null,
      imageRefs: imageRefs.length,
    };
    if (ids.length === 0) {
      return result;
    }

    const set: any = {};
    const unset: any = {};
    if (agentCard) {
      set.agentCard = agentCard;
    } else {
      unset.agentCard = '';
    }
    if (imageRefs.length) {
      set.imageRefs = imageRefs;
    } else {
      unset.imageRefs = '';
    }

    const update: any = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;

    const match: any = { _id: { $in: ids.map(id => new ObjectId(id)) } };
    if (orgId) {
      match.orgId = orgId;
    }

    const writeResult = await this.videoSceneModel.updateMany(match, update).exec();
    result.matched = writeResult.matchedCount ?? 0;
    result.updated = writeResult.modifiedCount ?? 0;
    return result;
  }

  /**
   * Updates only the properties that are present in the update object
   * @param id The ID of the entity to update
   * @param partialUpdates Object containing only the properties to update
   * @param orgId Optional organization ID to scope the update
   * @returns The updated entity
   */
  async partialUpdateFlattend(
    id: string,
    partialUpdates: Partial<IVideoProjectGenerator>,
    orgId?: string
  ): Promise<VideoGeneratorEntity> {
    // Convert nested objects to dot notation eg. { "video.captions.remotion": captions.captions }
    // This way you can only remove properties that are present in the update object
    const flattenedUpdates = flattenObject(this.stripSceneSummaries(partialUpdates));
    const query: any = { _id: id };
    if (orgId) {
      query.orgId = orgId;
    }
    const result = await this.videoGeneratorModel.findOneAndUpdate(query, { $set: flattenedUpdates }, { new: true }).exec();
    if (!result) {
      throw new AppException({ error_message: 'Video project not found or access denied', statusCode: 404 });
    }
    return result;
  }

  async remove(id: string): Promise<void> {
    await this.videoGeneratorModel.findByIdAndDelete(id).exec();
  }

  async addSourceToVideoProject(videoProjectId: string, sourceId: string, orgId?: string) {
    // According to hibrid relation strategy, save basic info including id, so i can remove it later
    const videoProject = await this.sourceService.findOne(sourceId, { _id: 0, id: 1, name: 1, description: 1, thumbnail: 1 });
    if (!videoProject) {
      throw new AppException({ error_message: 'Source not found', statusCode: 404 });
    }
    console.log(videoProject);

    const query: any = { _id: videoProjectId };
    if (orgId) {
      query.orgId = orgId;
    }

    const newSourceReference = { reference: new ObjectId(sourceId), ...videoProject };
    const result = await this.videoGeneratorModel.findOneAndUpdate(query, { $addToSet: { sources: newSourceReference } }, { new: true }).exec();
    if (!result) {
      throw new AppException({ error_message: 'Video project not found or access denied', statusCode: 404 });
    }
    return result;
  }

  async addAgentCardToVideoProject(videoProjectId: string, agentCardId: string, orgId?: string) {
    // According to hibrid relation strategy, save basic info including id, so i can remove it later
    const videoProject = await this.agentCardService.findOne(agentCardId, { _id: 0, id: 1, name: 1, assets: 1 });
    if (!videoProject) {
      throw new AppException({ error_message: 'Agent card not found', statusCode: 404 });
    }
    console.log(videoProject);

    const query: any = { _id: videoProjectId };
    if (orgId) {
      query.orgId = orgId;
    }

    const newAgentCardReference = { reference: new ObjectId(agentCardId), ...videoProject };
    const result = await this.videoGeneratorModel.findOneAndUpdate(query, { $set: { agentCard: newAgentCardReference } }, { new: true }).exec();
    if (!result) {
      throw new AppException({ error_message: 'Video project not found or access denied', statusCode: 404 });
    }
    return result;
  }

  async removeSourceFromVideoProject(videoProjectId: string, sourceId: string, orgId?: string) {
    const query: any = { _id: videoProjectId };
    if (orgId) {
      query.orgId = orgId;
    }
    const result = await this.videoGeneratorModel.findOneAndUpdate(query, { $pull: { sources: { id: sourceId } } }, { new: true }).exec();
    if (!result) {
      throw new AppException({ error_message: 'Video project not found or access denied', statusCode: 404 });
    }
    return result;
  }
}
