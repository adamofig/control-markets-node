import { Module } from '@nestjs/common';
import { TiktokBotService } from './tiktok-bot.service';

@Module({
  providers: [TiktokBotService],
  exports: [TiktokBotService],
})
export class TiktokBotModule {}
