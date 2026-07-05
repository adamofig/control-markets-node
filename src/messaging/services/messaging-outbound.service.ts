import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomBytes } from 'crypto';
import { ChannelIdentityEntity } from '../schemas/channel-identity.schema';
import { OutboundMessageEntity } from '../schemas/outbound-message.schema';
import { ChannelType, INotifyOptions, INotifyResult } from '../models/messaging.models';
import { ChannelGatewayService } from './channel-gateway.service';
import { TelegramAdapter } from '../adapters/telegram.adapter';

const LINK_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutos

/**
 * API interna única de mensajería saliente: heartbeats, triggerTasks, nodos del canvas
 * y la tool MCP llaman notifyUser() sin saber nada de canales. Resuelve la identidad
 * verificada del usuario, envía por el adapter correspondiente y audita en `outbound_messages`.
 */
@Injectable()
export class MessagingOutboundService {
  private readonly logger = new Logger(MessagingOutboundService.name);

  constructor(
    @InjectModel(ChannelIdentityEntity.name) private identityModel: Model<ChannelIdentityEntity>,
    @InjectModel(OutboundMessageEntity.name) private outboundModel: Model<OutboundMessageEntity>,
    private readonly gateway: ChannelGatewayService,
    private readonly telegramAdapter: TelegramAdapter,
  ) {}

  /** Envía una notificación a un usuario de la plataforma por su canal vinculado. */
  async notifyUser(userId: string, orgId: string, text: string, options: INotifyOptions = {}): Promise<INotifyResult> {
    const query: Record<string, unknown> = { userId, orgId, status: 'verified' };
    if (options.channel) query.channel = options.channel;

    const identity = await this.identityModel.findOne(query).lean();
    if (!identity?.address) {
      return { delivered: false, error: `El usuario ${userId} no tiene un canal de mensajería vinculado.` };
    }

    const adapter = this.gateway.getAdapter(identity.channel);
    if (!adapter) {
      return { delivered: false, channel: identity.channel, error: `El canal ${identity.channel} no está habilitado en el servidor.` };
    }

    const record = await this.outboundModel.create({
      orgId,
      userId,
      channel: identity.channel,
      address: identity.address,
      text,
      status: 'queued',
      source: options.source ?? 'system',
      sourceRef: options.sourceRef,
    });

    const result = await adapter.sendText(identity.address, text);

    record.status = result.success ? 'sent' : 'failed';
    record.providerMessageId = result.providerMessageId;
    record.error = result.error;
    record.sentAt = result.success ? new Date() : undefined;
    await record.save();

    if (!result.success) this.logger.error(`Notificación fallida a ${userId} vía ${identity.channel}: ${result.error}`);

    return { delivered: result.success, channel: identity.channel, address: identity.address, error: result.error };
  }

  /** Crea (o renueva) la identidad pendiente y devuelve el deep-link t.me para vincular Telegram. */
  async createTelegramLink(userId: string, orgId: string): Promise<{ linkUrl: string; expiresAt: Date }> {
    const linkToken = randomBytes(16).toString('base64url');
    const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS);

    await this.identityModel.findOneAndUpdate(
      { userId, orgId, channel: ChannelType.Telegram, status: { $ne: 'verified' } },
      { $set: { userId, orgId, channel: ChannelType.Telegram, status: 'pending', linkToken, linkTokenExpiresAt: expiresAt } },
      { upsert: true, new: true },
    );

    const botUsername = this.telegramAdapter.botUsername;
    if (!botUsername) throw new Error('TELEGRAM_BOT_USERNAME no configurado en el servidor.');

    return { linkUrl: `https://t.me/${botUsername}?start=${linkToken}`, expiresAt };
  }

  async listIdentities(userId: string, orgId: string): Promise<ChannelIdentityEntity[]> {
    return this.identityModel.find({ userId, orgId }).select('-linkToken').lean();
  }

  async unlinkIdentity(identityId: string, userId: string, orgId: string): Promise<{ deleted: boolean }> {
    const result = await this.identityModel.deleteOne({ id: identityId, userId, orgId });
    return { deleted: result.deletedCount > 0 };
  }
}
