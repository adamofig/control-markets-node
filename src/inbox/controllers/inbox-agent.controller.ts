import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AppToken } from '@dataclouder/nest-auth';
import { OrgId } from '../../common/org-id.decorator';
import { DecodedToken } from '../../common/token.decorator';
import { ProjectAuthGuard } from '../../user/project-auth.guard';
import { SendAgentInboxMessageDto } from '../dto/inbox.dto';
import { InboxPatDelegationGuard } from '../guards/inbox-pat-delegation.guard';
import { InboxAgentMessageService } from '../services/inbox-agent-message.service';
import { InboxIdentityService } from '../services/inbox-identity.service';

@ApiTags('inbox-agents')
@ApiBearerAuth()
@UseGuards(ProjectAuthGuard, InboxPatDelegationGuard)
@Controller('api/inbox/agents')
export class InboxAgentController {
  constructor(
    private readonly identities: InboxIdentityService,
    private readonly agentMessages: InboxAgentMessageService
  ) {}

  @Post(':agenticProfileId/messages')
  async sendAgentMessage(@DecodedToken() token: AppToken, @Param('agenticProfileId') agenticProfileId: string, @Body() dto: SendAgentInboxMessageDto, @OrgId() requestedOrgId?: string) {
    const actor = await this.identities.resolveActor(token, requestedOrgId);
    return this.agentMessages.sendDelegated(actor, agenticProfileId, dto);
  }
}
