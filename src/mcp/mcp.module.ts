import { Module } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { CreativeFlowboardModule } from '../creative-flowboard/creative-flowboard.module';
import { SocialMediaTrackerModule } from '../social-media-tracker/social-media-tracker.module';
import { McpFlowboardTools } from './mcp-flowboard.tools';
import { McpSocialTools } from './mcp-social.tools';

@Module({
  imports: [
    CreativeFlowboardModule,
    SocialMediaTrackerModule,
    McpModule.forFeature([McpFlowboardTools, McpSocialTools], 'control-markets'),
  ],
  providers: [McpFlowboardTools, McpSocialTools],
})
export class AppMcpModule {}
