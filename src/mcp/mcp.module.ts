import { Module } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { CreativeFlowboardModule } from '../creative-flowboard/creative-flowboard.module';
import { SocialMediaTrackerModule } from '../social-media-tracker/social-media-tracker.module';
import { AgentsModule } from '../agent-tasks/agent-tasks.module';
import { OrganizationModule } from '../organization/organization.module';
import { UserModule } from '../user/user.module';
import { McpFlowboardTools } from './mcp-flowboard.tools';
import { McpSocialTools } from './mcp-social.tools';
import { McpTasksTools } from './mcp-tasks.tools';
import { McpOrganizationTools } from './mcp-organization.tools';
import { McpUserTools } from './mcp-user.tools';

@Module({
  imports: [
    CreativeFlowboardModule,
    SocialMediaTrackerModule,
    AgentsModule,
    OrganizationModule,
    UserModule,
    McpModule.forFeature([McpFlowboardTools, McpSocialTools, McpTasksTools, McpOrganizationTools, McpUserTools], 'control-markets'),
  ],
  providers: [McpFlowboardTools, McpSocialTools, McpTasksTools, McpOrganizationTools, McpUserTools],
})
export class AppMcpModule {}
