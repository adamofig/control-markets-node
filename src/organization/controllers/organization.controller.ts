import { Controller, Post, Body, Param, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrganizationService } from '../services/organization.service';

import { EntityController } from '@dataclouder/nest-mongo';
import { AppGuard } from '@dataclouder/nest-core';
import { AppToken } from '@dataclouder/nest-auth';
import { OrganizationDocument } from '../schemas/organization.schema';
import { ProjectAuthGuard } from 'src/user/project-auth.guard';
import { DecodedToken } from 'src/common/token.decorator';
import { IOrgOperationRequester, OrgUserOperationDto } from '../models/organization-member.models';
import { isPlatformAdmin } from 'src/auth/org-permissions';

class AddUserToOrganizationDto {
  email: string;
}

@ApiTags('organization')
@ApiBearerAuth()
@Controller('api/organization') // NOT ENDPOINT Father will tell
export class OrganizationController extends EntityController<OrganizationDocument> {
  constructor(private readonly organizationService: OrganizationService) {
    super(organizationService);
  }

  /**
   * Overrides the inherited create/update route for one reason: `EntityController.save()` does not
   * pass the caller, and without `auditable.createdBy` the service cannot tell who should own the
   * new organization. The decorators are repeated because an override drops the parent's route
   * metadata, and `token` is optional so the signature stays compatible with the base class.
   *
   * The guard is not optional here: an unauthenticated create would produce exactly the ownerless
   * organizations the F2 migration had to report by hand.
   */
  @UseGuards(AppGuard, ProjectAuthGuard)
  @Post()
  override async save(@Body() createDto: any, @DecodedToken() token?: AppToken): Promise<OrganizationDocument> {
    if (token?.email) {
      createDto.auditable = {
        ...createDto?.auditable,
        createdBy: createDto?.auditable?.createdBy ?? token.email,
        updatedBy: token.email,
      };
    }
    return this.organizationService.save(createDto);
  }

  /**
   * The member list of an organization.
   *
   * Guarded from its first commit: it exposes emails and memberships. The class-level guard that
   * covers the inherited CRUD routes lands in F10; this one does not wait for it.
   * TODO(F11): add `@OrgPermission('members:read')` and validate `:orgId` against `req.ctx.orgId` —
   * today any authenticated user can read the members of any organization.
   */
  @UseGuards(AppGuard, ProjectAuthGuard)
  @Get(':orgId/members')
  async getMembers(@Param('orgId') orgId: string, @DecodedToken() token: AppToken) {
    return this.organizationService.getMembers(orgId, token?.email);
  }

  /**
   * @deprecated Use operateUserToOrganization instead
   */
  @UseGuards(AppGuard, ProjectAuthGuard)
  @Post(':orgId/add-user')
  async addUserToOrganization(@Param('orgId') orgId: string, @Body() addUserToOrganizationDto: AddUserToOrganizationDto, @DecodedToken() token: AppToken) {
    return this.organizationService.addUserToOrganization(orgId, addUserToOrganizationDto.email, undefined, this.requesterFrom(token));
  }

  /**
   * TODO(F11): add `@OrgPermission('members:manage')`. Until then the business invariants in the
   * service (last owner, no self-promotion, no granting above your own role) are the only control.
   */
  @UseGuards(AppGuard, ProjectAuthGuard)
  @Post(':orgId/operate-user')
  async operateUserToOrganization(@Param('orgId') orgId: string, @Body() dto: OrgUserOperationDto, @DecodedToken() token: AppToken) {
    return this.organizationService.operateUserToOrganization(orgId, dto, this.requesterFrom(token));
  }

  private requesterFrom(token: AppToken): IOrgOperationRequester {
    return { email: token?.email, isPlatformAdmin: isPlatformAdmin(token) };
  }
}
