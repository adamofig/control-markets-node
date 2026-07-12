import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppToken, DecodedToken } from '@dataclouder/nest-auth';
import { EntityMongoController } from '@dataclouder/nest-mongo';
import { OrgId } from '../../common/org-id.decorator';
import { ProjectAuthGuard } from '../../user/project-auth.guard';
import { AgenticConversationDocument } from '../schemas/agentic-conversation.schema';
import { AgenticConversationService } from '../services/agentic-conversation.service';

@ApiTags('agentic-conversation')
@Controller('api/agentic-conversation')
export class AgenticConversationController extends EntityMongoController<AgenticConversationDocument> {
  constructor(private readonly conversations: AgenticConversationService) { super(conversations); }

  @Post('operation')
  @ApiOperation({ summary: 'Execute an organization-scoped conversation database operation' })
  @UseGuards(ProjectAuthGuard)
  override async executeOperation(@Body() dto: any, @DecodedToken() token: AppToken, @OrgId() orgId?: string): Promise<any> {
    const resolvedOrgId = orgId || token?.userId || (token as any).id || (token as any).uid;
    if (!resolvedOrgId) throw new BadRequestException('Organization context is required');

    const scopedActions = ['find', 'findOne', 'count', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany'];
    if (scopedActions.includes(dto.action)) dto.query = { ...(dto.query ?? {}), orgId: resolvedOrgId };
    if (dto.action === 'create') {
      dto.payload = { ...(dto.payload ?? {}), orgId: resolvedOrgId };
      dto.payload.auditable = { ...dto.payload.auditable, createdBy: token?.email || 'system', updatedBy: token?.email || 'system' };
    }
    if (dto.action === 'updateOne' || dto.action === 'updateMany') {
      dto.payload = dto.payload ?? {};
      dto.payload.$set = { ...(dto.payload.$set ?? {}), 'auditable.updatedBy': token?.email || 'system' };
      delete dto.payload.$set.orgId;
    }
    return this.conversations.executeOperation(dto);
  }
}
