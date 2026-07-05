import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { ChatModule } from '../chat/chat.module';
import { UserModule } from '../user/user.module';
import { MessagingController } from './messaging.controller';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { ChannelGatewayService } from './services/channel-gateway.service';
import { MessagingOutboundService } from './services/messaging-outbound.service';
import { ChannelIdentityEntity, ChannelIdentitySchema } from './schemas/channel-identity.schema';
import { OutboundMessageEntity, OutboundMessageSchema } from './schemas/outbound-message.schema';

/**
 * Canal de mensajería externa (Telegram hoy; WhatsApp/Discord después).
 * Arquitectura: IChannelAdapter (strategy) → ChannelGatewayService (ruteo entrante
 * al bucle ReAct) + MessagingOutboundService (API interna de notificaciones).
 * Referencia: control-markets-wiki/12_agents/BORGES/explorations/2026-07-04-canal-mensajeria-whatsapp-telegram.md
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChannelIdentityEntity.name, schema: ChannelIdentitySchema },
      { name: OutboundMessageEntity.name, schema: OutboundMessageSchema },
    ]),
    NestAuthModule,
    UserModule,
    ChatModule,
  ],
  controllers: [MessagingController],
  providers: [TelegramAdapter, ChannelGatewayService, MessagingOutboundService],
  exports: [MessagingOutboundService],
})
export class MessagingModule {}
