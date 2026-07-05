import { ChannelType, IInboundMessage, ISendResult } from '../models/messaging.models';

export type InboundHandler = (message: IInboundMessage) => Promise<void>;

/**
 * Patrón strategy para canales de mensajería (igual que INodeProcessor en el flowboard).
 * Cada canal (Telegram, WhatsApp, Discord…) implementa esta interfaz y se registra
 * en el ChannelGatewayService — el resto de la plataforma nunca habla con un canal directo.
 */
export interface IChannelAdapter {
  readonly channel: ChannelType;

  /** true si el adapter tiene credenciales y está corriendo. */
  isEnabled(): boolean;

  /** Registra el handler del gateway para mensajes entrantes. */
  onInbound(handler: InboundHandler): void;

  /** Envía texto plano/markdown a una dirección nativa del canal (troceo interno si excede límites). */
  sendText(address: string, text: string): Promise<ISendResult>;
}
