import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityCommunicationService } from '@dataclouder/nest-mongo';

import { AgentCardService } from '@dataclouder/nest-agent-cards';
import { StorageAssetService } from '@dataclouder/nest-storage';
import { AgentTasksService } from 'src/agent-tasks/services/agent-tasks.service';
import { AgentOutcomeJobService } from 'src/agent-tasks/services/agent-job.service';
import { SourcesService } from 'src/agent-tasks/services/sources.service';
import { BlogEntryService } from 'src/blog-entry/services/blog-entry.service';
import { CreativeFlowboardService } from 'src/creative-flowboard/services/creative-flowboard.service';
import { InspirationSourceService } from 'src/inspiration-source/services/inspiration-source.service';
import { LeadService } from 'src/lead/services/lead.service';
import { OrganizationService } from 'src/organization/services/organization.service';
import { SocialMediaTrackerService } from 'src/social-media-tracker/services/social-media-tracker.service';
import { VideoGeneratorService } from 'src/video-projects/services/video-project-generator.service';
import { VideoSceneService } from 'src/video-scene/services/video-scene.service';
import { ChannelIdentityService } from 'src/messaging/services/channel-identity.service';
import { UniversalOperationDto } from './dto/universal-operation.dto';

@Injectable()
export class UniversalService {
  // Keys match each controller's route prefix, so /api/universal/{entity}/operation mirrors /api/{entity}/operation
  private readonly registry = new Map<string, EntityCommunicationService<any>>();

  constructor(
    organizationService: OrganizationService,
    agentTasksService: AgentTasksService,
    agentJobsService: AgentOutcomeJobService,
    sourcesService: SourcesService,
    agentCardService: AgentCardService,
    socialMediaTrackerService: SocialMediaTrackerService,
    creativeFlowboardService: CreativeFlowboardService,
    videoGeneratorService: VideoGeneratorService,
    videoSceneService: VideoSceneService,
    blogEntryService: BlogEntryService,
    inspirationSourceService: InspirationSourceService,
    leadService: LeadService,
    storageAssetService: StorageAssetService,
    channelIdentityService: ChannelIdentityService,
  ) {
    this.registry.set('organization', organizationService);
    this.registry.set('agent-tasks', agentTasksService);
    this.registry.set('agent-jobs', agentJobsService);
    this.registry.set('sources', sourcesService);
    this.registry.set('agent-cards', agentCardService);
    this.registry.set('social-media-tracker', socialMediaTrackerService);
    this.registry.set('creative-flowboard', creativeFlowboardService);
    this.registry.set('video-generator', videoGeneratorService);
    this.registry.set('video-projects', videoGeneratorService); // alias
    this.registry.set('video-scene', videoSceneService);
    this.registry.set('blog-entry', blogEntryService);
    this.registry.set('inspiration-source', inspirationSourceService);
    this.registry.set('lead', leadService);
    this.registry.set('storage-asset', storageAssetService);
    this.registry.set('channel-identity', channelIdentityService);
  }

  getRegisteredEntities(): string[] {
    return Array.from(this.registry.keys());
  }

  async executeOperation(entity: string, operationDto: UniversalOperationDto, userEmail?: string): Promise<any> {
    const service = this.registry.get(entity);
    if (!service) {
      throw new NotFoundException(`Entity '${entity}' is not registered. Available: ${this.getRegisteredEntities().join(', ')}`);
    }

    // Same auditable stamping as EntityMongoController.executeOperation
    if (userEmail && operationDto.payload) {
      if (operationDto.action === 'create') {
        operationDto.payload.auditable = { ...operationDto.payload.auditable, createdBy: userEmail, updatedBy: userEmail };
      } else if (operationDto.action === 'updateOne' || operationDto.action === 'updateMany') {
        if (!operationDto.payload.$set) {
          operationDto.payload.$set = {};
        }
        operationDto.payload.$set['auditable.updatedBy'] = userEmail;
      }
    }

    return service.executeOperation(operationDto);
  }
}
