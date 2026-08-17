import { Module } from '@nestjs/common';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { AgenticProfileModule } from '../agentic-profile/agentic-profile.module';
import { AgentSkillsModule } from '../agent-skills/agent-skills.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { LocalAgentController } from './local-agent.controller';
import { LocalAgentChatService } from './local-agent-chat.service';
import { FilesystemToolsService } from './filesystem-tools.service';
import { AcpBridgeService } from './acp-bridge.service';
import { KeyBalancerModule } from '../key-balancer/key-balancer.module';
import { MentionsModule } from '../mentions/mentions.module';

@Module({
  imports: [NestAuthModule, AgenticProfileModule, WorkspacesModule, KeyBalancerModule, AgentSkillsModule, MentionsModule],
  controllers: [LocalAgentController],
  providers: [LocalAgentChatService, FilesystemToolsService, AcpBridgeService],
  exports: [LocalAgentChatService, AcpBridgeService],
})
export class LocalAgentModule {}
