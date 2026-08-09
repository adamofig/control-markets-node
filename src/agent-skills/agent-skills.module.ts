import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { SkillEntity, SkillSchema } from './schemas/skill.schema';
import { SkillsService } from './services/skills.service';
import { SkillsController } from './controllers/skills.controller';

// ProjectAuthGuard is not imported here on purpose: `UserModule` is @Global(), so the guard and its
// UserEntityModel dependency already resolve. Importing it locally would only add a cycle risk.
@Module({
  imports: [MongooseModule.forFeature([{ name: SkillEntity.name, schema: SkillSchema }]), DCMongoDBModule, NestAuthModule],
  controllers: [SkillsController],
  providers: [SkillsService],
  exports: [SkillsService],
})
export class AgentSkillsModule {}
