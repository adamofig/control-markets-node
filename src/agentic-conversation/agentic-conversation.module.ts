import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { AgenticConversationController } from './controllers/agentic-conversation.controller';
import { AgenticConversationService } from './services/agentic-conversation.service';
import { AgenticConversationEntity, AgenticConversationSchema } from './schemas/agentic-conversation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: AgenticConversationEntity.name, schema: AgenticConversationSchema }]),
    DCMongoDBModule,
    NestAuthModule,
  ],
  controllers: [AgenticConversationController],
  providers: [AgenticConversationService],
  exports: [AgenticConversationService],
})
export class AgenticConversationModule {}
