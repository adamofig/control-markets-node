import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { AgenticProfileModule } from '../agentic-profile/agentic-profile.module';
import { LocalAgentModule } from '../local-agent/local-agent.module';
import { UserModule } from '../user/user.module';
import { AgenticHeartbeatController } from './agentic-heartbeat.controller';
import { AgenticHeartbeatService } from './agentic-heartbeat.service';
import { AgenticHeartbeatRunEntity, AgenticHeartbeatRunSchema } from './schemas/agentic-heartbeat-run.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: AgenticHeartbeatRunEntity.name, schema: AgenticHeartbeatRunSchema }]),
    NestAuthModule,
    UserModule,
    AgenticProfileModule,
    LocalAgentModule,
  ],
  controllers: [AgenticHeartbeatController],
  providers: [AgenticHeartbeatService],
  exports: [AgenticHeartbeatService],
})
export class AgenticHeartbeatModule {}
