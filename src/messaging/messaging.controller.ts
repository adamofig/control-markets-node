import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppToken, DecodedToken } from '@dataclouder/nest-auth';
import { OrgId } from '../common/org-id.decorator';
import { ProjectAuthGuard } from '../user/project-auth.guard';
import { AppGuard } from '@dataclouder/nest-core';
import { MessagingOutboundService } from './services/messaging-outbound.service';
import { ChannelType, INotifyResult } from './models/messaging.models';
import { ChannelIdentityEntity } from './schemas/channel-identity.schema';

/** F10: the seven per-method guards collapsed into one at class level — same coverage, no route can be added unguarded. */
@ApiTags('messaging')
@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/messaging')
export class MessagingController {
  constructor(private readonly outboundService: MessagingOutboundService) {}

  @Post('telegram/link')
  @ApiOperation({ summary: 'Genera un deep-link t.me para vincular la cuenta Telegram del usuario actual' })
  async createTelegramLink(@OrgId() orgId: string, @DecodedToken() token: AppToken): Promise<{ linkUrl: string; expiresAt: Date }> {
    return this.outboundService.createTelegramLink(token.uid, orgId);
  }

  @Get('identities')
  @ApiOperation({ summary: 'Lista los canales de mensajería vinculados del usuario actual' })
  async listIdentities(@OrgId() orgId: string, @DecodedToken() token: AppToken): Promise<ChannelIdentityEntity[]> {
    return this.outboundService.listIdentities(token.uid, orgId);
  }

  @Delete('identities/:id')
  @ApiOperation({ summary: 'Desvincula un canal de mensajería del usuario actual' })
  async unlinkIdentity(@Param('id') id: string, @OrgId() orgId: string, @DecodedToken() token: AppToken): Promise<{ deleted: boolean }> {
    return this.outboundService.unlinkIdentity(id, token.uid, orgId);
  }

  @Post('webpush/subscribe')
  @ApiOperation({ summary: 'Registra la suscripción web push (token FCM) del dispositivo actual — idempotente por token' })
  async subscribeWebPush(
    @Body() body: {
      token: string;
      platform?: string;
      deviceId?: string;
      metadata?: Record<string, any>;
      // Retrocompatibilidad
      userAgent?: string;
      standalone?: boolean;
    },
    @OrgId() orgId: string,
    @DecodedToken() token: AppToken,
  ): Promise<{ subscribed: boolean }> {
    return this.outboundService.subscribeWebPush(token.uid, orgId, body);
  }

  @Post('webpush/unsubscribe')
  @ApiOperation({ summary: 'Elimina la suscripción web push del dispositivo actual (por token FCM)' })
  async unsubscribeWebPush(
    @Body() body: { token: string },
    @OrgId() orgId: string,
    @DecodedToken() token: AppToken,
  ): Promise<{ deleted: boolean }> {
    return this.outboundService.unsubscribeWebPush(token.uid, orgId, body.token);
  }

  @Post('webpush/broadcast')
  @ApiOperation({ summary: 'Broadcast web push: scope "org" (dispositivos de la org actual) o "global" (toda la plataforma)' })
  async broadcastWebPush(
    @Body() body: { message: string; scope?: 'org' | 'global' },
    @OrgId() orgId: string,
    @DecodedToken() token: AppToken,
  ): Promise<{ delivered: number; failed: number; cleaned: number; totalDevices: number }> {
    const scope = body.scope ?? 'org';
    return this.outboundService.broadcastWebPush(body.message, { scope, orgId, source: 'manual', sourceRef: `broadcast-by:${token.uid}` });
  }

  @Post('notify')
  @ApiOperation({ summary: 'Envía una notificación de prueba/manual a un usuario por su canal vinculado' })
  async notify(
    @Body() body: { userId?: string; message: string; channel?: ChannelType },
    @OrgId() orgId: string,
    @DecodedToken() token: AppToken,
  ): Promise<INotifyResult> {
    const targetUserId = body.userId ?? token.uid;
    return this.outboundService.notifyUser(targetUserId, orgId, body.message, { channel: body.channel, source: 'manual' });
  }
}
