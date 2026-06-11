import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { AgenticProfileController } from './controllers/agentic-profile.controller';
import { AgenticProfileService } from './services/agentic-profile.service';
import { AgenticProfileEntity, AgenticProfileSchema } from './schemas/agentic-profile.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: AgenticProfileEntity.name, schema: AgenticProfileSchema }]),
    DCMongoDBModule,
    NestAuthModule,
  ],
  controllers: [AgenticProfileController],
  providers: [AgenticProfileService],
  exports: [AgenticProfileService],
})
export class AgenticProfileModule {}
