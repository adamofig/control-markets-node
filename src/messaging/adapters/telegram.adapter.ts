import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ChannelType, IInboundMessage, ISendResult } from '../models/messaging.models';
import { IChannelAdapter, InboundHandler } from './channel-adapter.interface';

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
    date: number;
  };
}

/**
 * Adapter de Telegram vía Bot API oficial usando long-polling (getUpdates).
 * No requiere webhook público — funciona en dev y producción sin ngrok.
 * Config: TELEGRAM_BOT_TOKEN (de BotFather) y TELEGRAM_BOT_USERNAME (para deep-links).
 */
@Injectable()
export class TelegramAdapter implements IChannelAdapter, OnModuleInit, OnModuleDestroy {
  readonly channel = ChannelType.Telegram;

  private readonly logger = new Logger(TelegramAdapter.name);
  private readonly botToken = process.env.TELEGRAM_BOT_TOKEN;
  readonly botUsername = process.env.TELEGRAM_BOT_USERNAME;

  private handler: InboundHandler | null = null;
  private polling = false;
  private offset = 0;

  isEnabled(): boolean {
    return !!this.botToken;
  }

  onInbound(handler: InboundHandler): void {
    this.handler = handler;
  }

  onModuleInit(): void {
    if (!this.isEnabled()) {
      this.logger.warn('TELEGRAM_BOT_TOKEN no configurado — TelegramAdapter deshabilitado.');
      return;
    }
    // Polling desactivado temporalmente para evitar conflictos con múltiples instancias de backend.
    this.polling = false;
    this.logger.warn('TelegramAdapter cargado (polling de Telegram DESACTIVADO temporalmente).');
  }

  onModuleDestroy(): void {
    this.polling = false;
  }

  async sendText(address: string, text: string): Promise<ISendResult> {
    if (!this.isEnabled()) return { success: false, error: 'Telegram no configurado' };
    try {
      let lastMessageId: string | undefined;
      for (const chunk of this.splitText(text)) {
        const result = await this.api('sendMessage', {
          chat_id: address,
          text: chunk,
          parse_mode: 'Markdown',
        }).catch(async err => {
          // Markdown inválido (p.ej. asteriscos sin cerrar del LLM) — reintentar en texto plano
          this.logger.warn(`sendMessage Markdown falló, reintentando plano: ${err.message}`);
          return this.api('sendMessage', { chat_id: address, text: chunk });
        });
        lastMessageId = String(result?.message_id ?? '');
      }
      return { success: true, providerMessageId: lastMessageId };
    } catch (err) {
      this.logger.error(`Error enviando a Telegram ${address}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  private splitText(text: string): string[] {
    if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      let cut = Math.min(TELEGRAM_MAX_MESSAGE_LENGTH, remaining.length);
      // preferir cortar en salto de línea para no romper markdown a media línea
      const newline = remaining.lastIndexOf('\n', cut);
      if (cut < remaining.length && newline > TELEGRAM_MAX_MESSAGE_LENGTH / 2) cut = newline;
      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
    return chunks;
  }

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      try {
        const updates: TelegramUpdate[] = await this.api('getUpdates', {
          offset: this.offset,
          timeout: 30,
          allowed_updates: ['message'],
        });
        for (const update of updates ?? []) {
          this.offset = update.update_id + 1;
          await this.dispatch(update);
        }
      } catch (err) {
        this.logger.error(`Error en polling de Telegram: ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  private async dispatch(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (!msg?.text || !this.handler) return;
    const inbound: IInboundMessage = {
      channel: ChannelType.Telegram,
      address: String(msg.chat.id),
      text: msg.text,
      senderName: msg.from?.username || msg.from?.first_name,
      raw: msg,
      receivedAt: new Date(msg.date * 1000),
    };
    try {
      await this.handler(inbound);
    } catch (err) {
      this.logger.error(`Error procesando mensaje entrante de Telegram: ${err.message}`, err.stack);
    }
  }

  private async api(method: string, body: Record<string, unknown>): Promise<any> {
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!data.ok) throw new Error(`Telegram API ${method}: ${data.description}`);
    return data.result;
  }
}
