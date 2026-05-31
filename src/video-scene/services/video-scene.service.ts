import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VideoSceneEntity, VideoSceneDocument } from '../schemas/video-scene.schema';
import { MongoService, EntityCommunicationService } from '@dataclouder/nest-mongo';
import { HttpService } from '@nestjs/axios';
import { CloudStorageService, StorageAssetService } from '@dataclouder/nest-storage';
import { firstValueFrom } from 'rxjs';
import { IAuditable } from '@dataclouder/nest-core';

@Injectable()
export class VideoSceneService extends EntityCommunicationService<VideoSceneDocument> {
  private readonly renderServerUrl = process.env.RENDER_SERVER_URL || 'http://localhost:8123';

  constructor(
    @InjectModel(VideoSceneEntity.name)
    videoSceneModel: Model<VideoSceneDocument>,
    mongoService: MongoService,
    private readonly httpService: HttpService,
    private readonly cloudStorageService: CloudStorageService,
    private readonly storageAssetService: StorageAssetService,
  ) {
    super(videoSceneModel, mongoService);
  }

  async renderScene(id: string, orgId: string | undefined, auditable: IAuditable): Promise<VideoSceneEntity> {
    const scene = await this.findOne(id);
    if (!scene) {
      throw new NotFoundException(`Video scene with ID ${id} not found`);
    }

    // Update status to rendering
    await this.update(id, { status: 'rendering', auditable });

    try {
      // Call render microservice
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.renderServerUrl}/render`,
          { scene },
          { responseType: 'arraybuffer' }
        )
      );

      const fileBuffer = Buffer.from(response.data);
      const bucketName = process.env.STORAGE_BUCKET;
      const filename = `rendered-scenes/${id}-${Date.now()}.mp4`;

      // Upload rendered MP4 to storage
      const uploadResult = await this.cloudStorageService.uploadFileAndMakePublic(
        bucketName,
        filename,
        fileBuffer,
        'video/mp4'
      );

      // Create a persistent StorageAsset document in MongoDB
      const storageAsset = await this.storageAssetService.save({
        orgId, // Link the asset to the organization
        type: 'video',
        name: scene.name ? `${scene.name} (Render)` : `Scene #${scene.index} Render`,
        description: scene.description || `Rendered video for Scene #${scene.index}`,
        storage: {
          url: uploadResult.url,
          path: uploadResult.path,
          bucket: uploadResult.bucket,
          provider: uploadResult.provider || 'gcs',
          name: `${id}.mp4`,
          size: fileBuffer.length,
          type: 'video/mp4',
          auditable,
        },
        generationMetadata: {
          provider: 'remotion',
          model: 'control-render',
          prompt: scene.dialog?.content || '',
          generatedAt: new Date().toISOString(),
        },
        auditable,
      });

      const assetId = (storageAsset as any)._id ? (storageAsset as any)._id.toString() : storageAsset.id;

      const videoStorage = {
        _id: assetId,
        id: assetId,
        type: 'video',
        storage: storageAsset.storage,
        generationMetadata: storageAsset.generationMetadata,
      };

      // Set final status to ready
      return await this.update(id, {
        status: 'ready',
        videoStorage,
        auditable,
      });

    } catch (error: any) {
      console.error(`Failed to render scene ${id}:`, error.message);
      await this.update(id, { status: 'failed', auditable });
      throw error;
    }
  }

  async renderSceneOnly(scene: any): Promise<Buffer> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.renderServerUrl}/render`,
          { scene },
          { responseType: 'arraybuffer' }
        )
      );
      return Buffer.from(response.data);
    } catch (error: any) {
      console.error(`Failed to preview render scene:`, error.message);
      throw error;
    }
  }
}
