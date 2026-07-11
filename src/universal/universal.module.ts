import { Module } from '@nestjs/common';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { AgentCardsModule } from '@dataclouder/nest-agent-cards';
import { UserModule } from 'src/user/user.module';
import { OrganizationModule } from 'src/organization/organization.module';
import { AgentsModule } from 'src/agent-tasks/agent-tasks.module';
import { SocialMediaTrackerModule } from 'src/social-media-tracker/social-media-tracker.module';
import { CreativeFlowboardModule } from 'src/creative-flowboard/creative-flowboard.module';
import { VideoGeneratorModule } from 'src/video-projects/video-project-generator.module';
import { VideoSceneModule } from 'src/video-scene/video-scene.module';
import { BlogEntryModule } from 'src/blog-entry/blog-entry.module';
import { InspirationSourceModule } from 'src/inspiration-source/inspiration-source.module';
import { LeadModule } from 'src/lead/lead.module';
import { StorageAssetOverrideModule } from 'src/storage-asset/storage-asset-override.module';
import { MessagingModule } from 'src/messaging/messaging.module';
import { UniversalController } from './universal.controller';
import { UniversalService } from './universal.service';

@Module({
  imports: [
    NestAuthModule,
    UserModule,
    OrganizationModule,
    AgentsModule,
    AgentCardsModule,
    SocialMediaTrackerModule,
    CreativeFlowboardModule,
    VideoGeneratorModule,
    VideoSceneModule,
    BlogEntryModule,
    InspirationSourceModule,
    LeadModule,
    StorageAssetOverrideModule,
    MessagingModule,
  ],
  controllers: [UniversalController],
  providers: [UniversalService],
})
export class UniversalModule {}
