import { Injectable, Logger } from '@nestjs/common';
import { getMessaging } from 'firebase-admin/messaging';
import { ChannelType, ISendResult } from '../models/messaging.models';
import { IChannelAdapter, InboundHandler } from './channel-adapter.interface';

/** Código FCM que indica que la suscripción murió y hay que borrar la identidad (equivalente al 410 de Web Push). */
export const FCM_TOKEN_DEAD_CODE = 'messaging/registration-token-not-registered';

/**
 * Canal saliente de notificaciones Web Push (PWA) vía FCM HTTP v1.
 * `address` = token FCM del dispositivo. Solo salida: onInbound es no-op (el
 * usuario responde dentro de la app, no por la notificación).
 * Usa el default app de firebase-admin ya inicializado en FirebaseService.
 */
@Injectable()
export class WebPushAdapter implements IChannelAdapter {
  readonly channel = ChannelType.WebPush;
  private readonly logger = new Logger(WebPushAdapter.name);

  isEnabled(): boolean {
    return true; // firebase-admin siempre está inicializado (auth depende de él)
  }

  onInbound(_handler: InboundHandler): void {
    // Web Push no tiene mensajes entrantes.
  }

  async sendText(address: string, text: string, options?: { title?: string; url?: string }): Promise<ISendResult> {
    try {
      const title = options?.title ?? 'Control Markets';
      const url = options?.url ?? '/';
      const providerMessageId = await getMessaging().send({
        token: address,
        notification: { title, body: text },
        data: { url },
        webpush: {
          headers: {
            Urgency: 'high',
          },
          notification: { icon: '/icons/icon-192.png', badge: '/icons/badge-monochrome.png' },
          fcmOptions: { link: url },
        },
      });
      return { success: true, providerMessageId };
    } catch (error: any) {
      const code: string = error?.code ?? '';
      if (code !== FCM_TOKEN_DEAD_CODE) {
        this.logger.error(`Error enviando web push: ${code} — ${error?.message}`);
      }
      return { success: false, error: code || error?.message || 'unknown' };
    }
  }
}
