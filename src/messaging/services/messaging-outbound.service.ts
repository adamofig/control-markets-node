import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import { ChannelIdentityEntity } from '../schemas/channel-identity.schema';
import { OutboundMessageEntity } from '../schemas/outbound-message.schema';
import { ChannelType, INotifyOptions, INotifyResult } from '../models/messaging.models';
import { ChannelGatewayService } from './channel-gateway.service';
import { TelegramAdapter } from '../adapters/telegram.adapter';
import { FCM_TOKEN_DEAD_CODE } from '../adapters/webpush.adapter';

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

    // Web Push es multi-dispositivo: enviar a TODAS las suscripciones verificadas del usuario.
    if (identity.channel === ChannelType.WebPush) {
      return this.notifyWebPushFanOut(userId, orgId, text, options);
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

  /**
   * Fan-out Web Push: envía a todas las suscripciones (tokens FCM) del usuario y
   * elimina las muertas (`registration-token-not-registered`). Éxito si al menos
   * un dispositivo recibió la notificación.
   */
  private async notifyWebPushFanOut(userId: string, orgId: string, text: string, options: INotifyOptions = {}): Promise<INotifyResult> {
    const identities = await this.identityModel.find({ userId, orgId, channel: ChannelType.WebPush, status: 'verified' }).lean();
    const adapter = this.gateway.getAdapter(ChannelType.WebPush);
    if (!adapter) return { delivered: false, channel: ChannelType.WebPush, error: 'El canal webpush no está habilitado en el servidor.' };

    let delivered = 0;
    let lastError: string | undefined;

    for (const identity of identities) {
      if (!identity.address) continue;
      const record = await this.outboundModel.create({
        orgId,
        userId,
        channel: ChannelType.WebPush,
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

      if (result.success) {
        delivered++;
      } else {
        lastError = result.error;
        if (result.error === FCM_TOKEN_DEAD_CODE) {
          // Suscripción muerta (equivalente al 410 de Web Push): limpiar la identidad.
          await this.identityModel.deleteOne({ _id: identity._id });
          this.logger.log(`Suscripción webpush muerta eliminada para user ${userId} (${String(identity.address).slice(0, 12)}…)`);
        }
      }
    }

    if (!delivered) {
      this.logger.error(`Web push fallido a ${userId}: ${lastError ?? 'sin suscripciones activas'}`);
      return { delivered: false, channel: ChannelType.WebPush, error: lastError ?? 'El usuario no tiene suscripciones web push activas.' };
    }
    return { delivered: true, channel: ChannelType.WebPush, address: `${delivered} dispositivo(s)` };
  }

  /**
   * Registra (idempotente por token) la suscripción web push de un dispositivo.
   * Se llama al activar y en cada arranque (re-sync); la identidad nace `verified`
   * porque el token FCM ya prueba posesión del dispositivo.
   */
  async subscribeWebPush(
    userId: string,
    orgId: string,
    dto: { token: string; platform?: string; userAgent?: string; standalone?: boolean },
  ): Promise<{ subscribed: boolean }> {
    if (!dto?.token) throw new Error('token requerido');
    // El hook post-save `addIdAfterSave` no corre en upsert; seteamos `id` explícitamente (ver §7-bis REBECA.md).
    const newId = new Types.ObjectId();
    await this.identityModel.findOneAndUpdate(
      { channel: ChannelType.WebPush, address: dto.token },
      {
        $set: {
          userId,
          orgId,
          channel: ChannelType.WebPush,
          address: dto.token,
          status: 'verified',
          verifiedAt: new Date(),
          metadata: { platform: dto.platform ?? 'web', userAgent: dto.userAgent, standalone: dto.standalone },
        },
        $setOnInsert: { _id: newId, id: newId.toString() },
      },
      { upsert: true, new: true },
    );
    return { subscribed: true };
  }

  /** Elimina la suscripción web push de un dispositivo (por su token FCM). */
  async unsubscribeWebPush(userId: string, orgId: string, token: string): Promise<{ deleted: boolean }> {
    const result = await this.identityModel.deleteOne({ channel: ChannelType.WebPush, address: token, userId, orgId });
    return { deleted: result.deletedCount > 0 };
  }

  /** Crea (o renueva) la identidad pendiente y devuelve el deep-link t.me para vincular Telegram. */
  async createTelegramLink(userId: string, orgId: string): Promise<{ linkUrl: string; expiresAt: Date }> {
    const linkToken = randomBytes(16).toString('base64url');
    const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS);

    // El hook post-save `addIdAfterSave` no corre en upsert; seteamos `id` explícitamente
    // al insertar para no violar el índice único `{ id: 1 }` (dejaría `id: null` → E11000).
    const newId = new Types.ObjectId();
    await this.identityModel.findOneAndUpdate(
      { userId, orgId, channel: ChannelType.Telegram, status: { $ne: 'verified' } },
      {
        $set: { userId, orgId, channel: ChannelType.Telegram, status: 'pending', linkToken, linkTokenExpiresAt: expiresAt },
        $setOnInsert: { _id: newId, id: newId.toString() },
      },
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
