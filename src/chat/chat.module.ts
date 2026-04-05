import { Module } from '@nestjs/common';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { UserModule } from '../user/user.module';
import { CreativeFlowboardModule } from '../creative-flowboard/creative-flowboard.module';

@Module({
  imports: [NestAuthModule, UserModule, CreativeFlowboardModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
