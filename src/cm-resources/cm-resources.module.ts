import { Module } from '@nestjs/common';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { AgentSkillsModule } from '../agent-skills/agent-skills.module';
import { AgentsModule } from '../agent-tasks/agent-tasks.module';
import { AgenticProfileModule } from '../agentic-profile/agentic-profile.module';
import { CmResourceResolver } from './cm-resource.resolver';
import { CmResourceTools } from './cm-resources.tools';
import { CmResourcesController } from './cm-resources.controller';

/**
 * The `cm://` address space and its single read verb.
 *
 * Imports the four domain modules it *orchestrates* — it owns no collection of its own, by design:
 * the day a resource family moves or its schema changes, that family's service absorbs it and this
 * module does not notice.
 */
@Module({
  imports: [NestAuthModule, AgentSkillsModule, AgentsModule, AgenticProfileModule],
  controllers: [CmResourcesController],
  providers: [CmResourceResolver, CmResourceTools],
  exports: [CmResourceResolver, CmResourceTools],
})
export class CmResourcesModule {}
