import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { AgenticProfileModule } from '../agentic-profile/agentic-profile.module';
import { LocalAgentModule } from '../local-agent/local-agent.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { UserModule } from '../user/user.module';
import { AgenticHeartbeatController, AgenticHeartbeatGlobalController } from './agentic-heartbeat.controller';
import { AgenticHeartbeatService } from './agentic-heartbeat.service';
import { AgenticHeartbeatRunEntity, AgenticHeartbeatRunSchema } from './schemas/agentic-heartbeat-run.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: AgenticHeartbeatRunEntity.name, schema: AgenticHeartbeatRunSchema }]),
    NestAuthModule,
    UserModule,
    AgenticProfileModule,
    LocalAgentModule,
    WorkspacesModule,
  ],
  controllers: [AgenticHeartbeatController, AgenticHeartbeatGlobalController],
  providers: [AgenticHeartbeatService],
  exports: [AgenticHeartbeatService],
})
export class AgenticHeartbeatModule {}
