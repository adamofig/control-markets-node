import { Controller, Post, Body, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { StorageAssetService } from '@dataclouder/nest-storage';
import { EntityMongoController } from '@dataclouder/nest-mongo';
import { StorageAssetExtendedDocument } from './schemas/storage-asset-extended.schema';
import { OrgId } from '../common/org-id.decorator';
import { AppToken, DecodedToken } from '@dataclouder/nest-auth';
import { AppGuard } from '@dataclouder/nest-core';
import { ProjectAuthGuard } from '../user/project-auth.guard';
import { isPlatformAdmin } from '../auth/platform-roles';

/**
 * F10: class-level guard. `operation` used `AuthGuard` (Firebase only); the class now applies
 * `ProjectAuthGuard`, so agents with a PAT can manage their own assets, and the inherited CRUD
 * routes stop being anonymous.
 */
@ApiTags('Storage Asset')
@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/storage-asset')
export class StorageAssetController extends EntityMongoController<StorageAssetExtendedDocument> {
  private readonly logger = new Logger('StorageAssetController');

  constructor(protected readonly storageAssetService: StorageAssetService) {
    super(storageAssetService as any);
  }

  @Post('operation')
  @ApiOperation({
    summary: 'Execute a single database operation',
    description: 'Enforces orgId on all Storage Asset database operations.',
  })
  @ApiResponse({ status: 200, description: 'The operation was successful.' })
  override async executeOperation(
    @Body() operationDto: any,
    @DecodedToken() token: AppToken,
    @OrgId() orgId?: string,
  ): Promise<any> {
    const userEmail = token?.email;
    const isBypass = isPlatformAdmin(token) && operationDto.options?.adminBypass;
    const resolvedOrgId = isBypass ? undefined : (orgId || token?.userId || (token as any).id || (token as any).uid);

    if (isBypass) {
      // Dropping the tenant filter must never happen silently.
      this.logger.warn(`[ADMIN_BYPASS] storage-asset ${operationDto.action} | actor=${userEmail ?? '-'} | requestedOrgId=${orgId ?? '-'}`);
    }

    if (operationDto.payload) {
      if (operationDto.action === 'create') {
        operationDto.payload.auditable = {
          ...operationDto.payload.auditable,
          createdBy: userEmail || 'system',
          updatedBy: userEmail || 'system',
        };
        // Inject orgId into payload for new Storage Asset
        if (resolvedOrgId) {
          operationDto.payload.orgId = resolvedOrgId;
        }
      } else if (operationDto.action === 'updateOne' || operationDto.action === 'updateMany') {
        if (!operationDto.payload.$set) {
          operationDto.payload.$set = {};
        }
        operationDto.payload.$set['auditable.updatedBy'] = userEmail || 'system';
        // Enforce update boundary to only match orgId
        if (resolvedOrgId) {
          operationDto.query = { ...operationDto.query, orgId: resolvedOrgId };
        }
      }
    }

    // Force queries on find/delete actions to only retrieve/modify within the active orgId
    if (resolvedOrgId && (
      operationDto.action === 'find' ||
      operationDto.action === 'findOne' ||
      operationDto.action === 'count' ||
      operationDto.action === 'deleteOne' ||
      operationDto.action === 'deleteMany'
    )) {
      operationDto.query = { ...operationDto.query, orgId: resolvedOrgId };
    }

    return await this.entityCommunicationService.executeOperation(operationDto);
  }
}
