import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { AgenticProfileController } from './controllers/agentic-profile.controller';
import { AgenticProfileService } from './services/agentic-profile.service';
import { AgenticProfileEntity, AgenticProfileSchema } from './schemas/agentic-profile.schema';
import { AgentsModule } from '../agent-tasks/agent-tasks.module';
import { AgentCardsModule } from '@dataclouder/nest-agent-cards';
import { AgentSkillsModule } from '../agent-skills/agent-skills.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: AgenticProfileEntity.name, schema: AgenticProfileSchema }]),
    DCMongoDBModule,
    NestAuthModule,
    AgentsModule,
    AgentCardsModule,
    AgentSkillsModule,
  ],
  controllers: [AgenticProfileController],
  providers: [AgenticProfileService],
  exports: [AgenticProfileService],
})
export class AgenticProfileModule {}
