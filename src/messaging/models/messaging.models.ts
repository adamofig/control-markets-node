export enum ChannelType {
  Telegram = 'telegram',
  WhatsApp = 'whatsapp',
  Discord = 'discord',
  WebPush = 'webpush',
}

export type IdentityStatus = 'pending' | 'verified' | 'revoked';

export type OutboundStatus = 'queued' | 'sent' | 'failed';

export type OutboundSource = 'heartbeat' | 'task' | 'mcp' | 'manual' | 'chat-reply' | 'system';

/** Mensaje entrante normalizado — todo adapter debe convertir su payload nativo a esto. */
export interface IInboundMessage {
  channel: ChannelType;
  /** Dirección nativa del remitente en el canal: chatId de Telegram, E.164 en WhatsApp. */
  address: string;
  text: string;
  senderName?: string;
  /** Payload crudo del canal por si el gateway necesita detalles específicos. */
  raw?: unknown;
  receivedAt: Date;
}

export interface ISendResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface INotifyOptions {
  /** Canal preferido; si se omite se usa cualquier identidad verificada del usuario. */
  channel?: ChannelType;
  source?: OutboundSource;
  /** Referencia libre al origen (taskId, runId de heartbeat, etc.) para auditoría. */
  sourceRef?: string;
}

export interface INotifyResult {
  delivered: boolean;
  channel?: ChannelType;
  address?: string;
  error?: string;
}
