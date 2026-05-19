import { Module } from '@nestjs/common';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { OrganizationModule } from '../organization/organization.module';
import { CreativeFlowboardModule } from '../creative-flowboard/creative-flowboard.module';
import { AgentsModule } from '../agent-tasks/agent-tasks.module';

@Module({
  imports: [NestAuthModule, OrganizationModule, CreativeFlowboardModule, AgentsModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
