import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppToken } from '@dataclouder/nest-auth';
import { ChatService } from '../../chat/chat.service';
import { AppUserService } from '../../user/user.service';
import { ChannelIdentityEntity } from '../schemas/channel-identity.schema';
import { ChannelType, IInboundMessage } from '../models/messaging.models';
import { IChannelAdapter } from '../adapters/channel-adapter.interface';
import { TelegramAdapter } from '../adapters/telegram.adapter';

/** Silencio requerido antes de despachar mensajes agrupados de un mismo chat (patrón Hermes). */
const INBOUND_BUFFER_MS = 5000;

interface PendingBuffer {
  messages: IInboundMessage[];
  timer: NodeJS.Timeout;
}

/**
 * Fuente de verdad del ruteo de mensajería externa (patrón gateway de OpenClaw/Hermes):
 * normaliza entrantes de cualquier canal, resuelve identidad → usuario/org (opt-in
 * obligatorio), agrupa ráfagas de mensajes y despacha al bucle ReAct existente (ChatService).
 */
@Injectable()
export class ChannelGatewayService implements OnModuleInit {
  private readonly logger = new Logger(ChannelGatewayService.name);
  private readonly adapters = new Map<ChannelType, IChannelAdapter>();
  private readonly buffers = new Map<string, PendingBuffer>();

  constructor(
    @InjectModel(ChannelIdentityEntity.name) private identityModel: Model<ChannelIdentityEntity>,
    private readonly telegramAdapter: TelegramAdapter,
    private readonly chatService: ChatService,
    private readonly userService: AppUserService,
  ) {}

  onModuleInit(): void {
    this.registerAdapter(this.telegramAdapter);
  }

  registerAdapter(adapter: IChannelAdapter): void {
    this.adapters.set(adapter.channel, adapter);
    adapter.onInbound(message => this.handleInbound(message));
  }

  getAdapter(channel: ChannelType): IChannelAdapter | undefined {
    const adapter = this.adapters.get(channel);
    return adapter?.isEnabled() ? adapter : undefined;
  }

  private async handleInbound(message: IInboundMessage): Promise<void> {
    // 1. Deep-link de vinculación: /start <token> (Telegram) — no requiere identidad previa.
    const linkToken = this.extractLinkToken(message.text);
    if (linkToken) return this.completeLink(message, linkToken);

    // 2. Opt-in obligatorio: sin identidad verificada se descarta (allowlist por diseño).
    const identity = await this.identityModel
      .findOne({ channel: message.channel, address: message.address, status: 'verified' })
      .lean();

    if (!identity) {
      this.logger.warn(`Mensaje descartado de ${message.channel}:${message.address} — sin identidad verificada.`);
      await this.reply(
        message,
        'Hola 👋 Esta cuenta no está vinculada a Control Markets. Vinculá tu cuenta desde tu perfil en la plataforma para conversar conmigo.',
      );
      return;
    }

    // 3. Buffer anti-fragmentos: agrupar ráfagas del mismo chat y despachar tras ~5 s de silencio.
    this.bufferMessage(message, identity);
  }

  private bufferMessage(message: IInboundMessage, identity: ChannelIdentityEntity): void {
    const key = `${message.channel}:${message.address}`;
    const existing = this.buffers.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      existing.messages.push(message);
      existing.timer = setTimeout(() => this.flushBuffer(key, identity), INBOUND_BUFFER_MS);
    } else {
      this.buffers.set(key, {
        messages: [message],
        timer: setTimeout(() => this.flushBuffer(key, identity), INBOUND_BUFFER_MS),
      });
    }
  }

  private async flushBuffer(key: string, identity: ChannelIdentityEntity): Promise<void> {
    const buffer = this.buffers.get(key);
    this.buffers.delete(key);
    if (!buffer?.messages.length) return;

    const combined = buffer.messages.map(m => m.text).join('\n');
    const lastMessage = buffer.messages[buffer.messages.length - 1];
    try {
      await this.routeToAgent(lastMessage, identity, combined);
    } catch (err) {
      this.logger.error(`Error en el bucle agéntico para ${key}: ${err.message}`, err.stack);
      await this.reply(lastMessage, '⚠️ Ocurrió un error procesando tu mensaje. Intentá de nuevo en un momento.');
    }
  }

  /** Despacha el texto al mismo bucle ReAct del chat interno, con el contexto del usuario vinculado. */
  private async routeToAgent(message: IInboundMessage, identity: ChannelIdentityEntity, text: string): Promise<void> {
    const user = await this.userService.findUserById(identity.userId);
    const token = {
      userId: identity.userId,
      email: user?.email ?? '',
      name: (user as any)?.personalData?.firstname ?? identity.displayName ?? '',
      orgId: identity.orgId,
    } as unknown as AppToken;

    const agentCardId = await this.resolveAgentCardId(identity);
    const stream = await this.chatService.streamChat([{ role: 'user', content: text }], token, identity.orgId, agentCardId);

    let output = '';
    for await (const delta of stream) output += delta;

    if (output.trim()) await this.reply(message, output);
  }

  /** Multi-agent routing: si la identidad tiene un perfil agéntico asignado, usar su agent card. */
  private async resolveAgentCardId(identity: ChannelIdentityEntity): Promise<string | undefined> {
    return (identity.metadata?.agentCardId as string) ?? undefined;
  }

  private extractLinkToken(text: string): string | null {
    const match = text?.trim().match(/^\/start\s+([A-Za-z0-9_-]{8,})$/);
    return match ? match[1] : null;
  }

  private async completeLink(message: IInboundMessage, linkToken: string): Promise<void> {
    const identity = await this.identityModel.findOne({
      linkToken,
      channel: message.channel,
      status: 'pending',
      linkTokenExpiresAt: { $gt: new Date() },
    });

    if (!identity) {
      await this.reply(message, 'El enlace de vinculación es inválido o expiró. Generá uno nuevo desde tu perfil en Control Markets.');
      return;
    }

    identity.address = message.address;
    identity.status = 'verified';
    identity.verifiedAt = new Date();
    identity.displayName = message.senderName;
    identity.linkToken = undefined;
    identity.linkTokenExpiresAt = undefined;
    await identity.save();

    this.logger.log(`Identidad ${message.channel} vinculada: user ${identity.userId} ↔ ${message.address}`);
    await this.reply(
      message,
      '✅ ¡Cuenta vinculada con Control Markets! A partir de ahora tus agentes pueden escribirte por acá, y vos podés hablarles directamente.',
    );
  }

  private async reply(message: IInboundMessage, text: string): Promise<void> {
    const adapter = this.getAdapter(message.channel);
    if (adapter) await adapter.sendText(message.address, text);
  }
}
