import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppToken, DecodedToken } from '@dataclouder/nest-auth';
import { OrgId } from '../common/org-id.decorator';
import { ProjectAuthGuard } from '../user/project-auth.guard';
import { MessagingOutboundService } from './services/messaging-outbound.service';
import { ChannelType, INotifyResult } from './models/messaging.models';
import { ChannelIdentityEntity } from './schemas/channel-identity.schema';

@ApiTags('messaging')
@Controller('api/messaging')
export class MessagingController {
  constructor(private readonly outboundService: MessagingOutboundService) {}

  @Post('telegram/link')
  @ApiOperation({ summary: 'Genera un deep-link t.me para vincular la cuenta Telegram del usuario actual' })
  @UseGuards(ProjectAuthGuard)
  async createTelegramLink(@OrgId() orgId: string, @DecodedToken() token: AppToken): Promise<{ linkUrl: string; expiresAt: Date }> {
    return this.outboundService.createTelegramLink(token.uid, orgId);
  }

  @Get('identities')
  @ApiOperation({ summary: 'Lista los canales de mensajería vinculados del usuario actual' })
  @UseGuards(ProjectAuthGuard)
  async listIdentities(@OrgId() orgId: string, @DecodedToken() token: AppToken): Promise<ChannelIdentityEntity[]> {
    return this.outboundService.listIdentities(token.uid, orgId);
  }

  @Delete('identities/:id')
  @ApiOperation({ summary: 'Desvincula un canal de mensajería del usuario actual' })
  @UseGuards(ProjectAuthGuard)
  async unlinkIdentity(@Param('id') id: string, @OrgId() orgId: string, @DecodedToken() token: AppToken): Promise<{ deleted: boolean }> {
    return this.outboundService.unlinkIdentity(id, token.uid, orgId);
  }

  @Post('notify')
  @ApiOperation({ summary: 'Envía una notificación de prueba/manual a un usuario por su canal vinculado' })
  @UseGuards(ProjectAuthGuard)
  async notify(
    @Body() body: { userId?: string; message: string; channel?: ChannelType },
    @OrgId() orgId: string,
    @DecodedToken() token: AppToken,
  ): Promise<INotifyResult> {
    const targetUserId = body.userId ?? token.uid;
    return this.outboundService.notifyUser(targetUserId, orgId, body.message, { channel: body.channel, source: 'manual' });
  }
}
