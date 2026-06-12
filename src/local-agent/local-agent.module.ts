import { Module } from '@nestjs/common';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { AgenticProfileModule } from '../agentic-profile/agentic-profile.module';
import { LocalAgentController } from './local-agent.controller';
import { LocalAgentChatService } from './local-agent-chat.service';
import { FilesystemToolsService } from './filesystem-tools.service';
import { AcpBridgeService } from './acp-bridge.service';

@Module({
  imports: [NestAuthModule, AgenticProfileModule],
  controllers: [LocalAgentController],
  providers: [LocalAgentChatService, FilesystemToolsService, AcpBridgeService],
})
export class LocalAgentModule {}
