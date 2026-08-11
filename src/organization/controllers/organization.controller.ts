import { Controller, Post, Body, Param, Get, Put, UseGuards, ForbiddenException, Logger } from '@nestjs/common';
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
import { OrgContextGuard } from 'src/auth/org-context.guard';
import { OrgPermission } from 'src/auth/org-permission.decorator';
import { OrgContextService } from 'src/auth/org-context.service';
import { hasOrgPermission } from 'src/auth/org-permissions';
import { NotOrgScoped } from 'src/auth/not-org-scoped.decorator';

class AddUserToOrganizationDto {
  email: string;
}

/**
 * F10: the guard moved to class level, which is what finally covers the routes this controller
 * *inherits* from `EntityController` (`query`, `find-one`, `create`, `update`, `batch`, `operation`).
 * Until this commit `POST /api/organization/query` with no token listed every organization on the
 * platform, and `POST /:orgId/operate-user` let anyone add themselves anywhere.
 *
 * F11 adds `OrgContextGuard` on top: it resolves `req.ctx` for every route and enforces the
 * `@OrgPermission` decorators below. The inherited CRUD routes still carry no permission decorator —
 * they are authenticated, not authorized, until the global guard and the org-scope interceptor land
 * (F12/F14a).
 */
@ApiTags('organization')
@NotOrgScoped('An organization is identified by its own _id, not by an orgId field. This controller is already authorized per role by the F11 rules, which is the check that belongs here.')
@ApiBearerAuth()
@UseGuards(AppGuard, ProjectAuthGuard, OrgContextGuard)
@Controller('api/organization') // NOT ENDPOINT Father will tell
export class OrganizationController extends EntityController<OrganizationDocument> {
  private readonly logger = new Logger('OrganizationController');

  constructor(
    private readonly organizationService: OrganizationService,
    private readonly orgContext: OrgContextService
  ) {
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
   *
   * F11: this is one route doing two jobs. **Creating** an organization needs no permission — there
   * is no organization to hold one yet, and the service makes the creator its Owner. **Updating**
   * one needs `org:settings`, so it cannot go through a `@OrgPermission` decorator: the target org
   * is the document's own id, in the body, and the decorator only reads route params. Hence the
   * explicit check. Without it a Viewer could still rename the organization by POSTing the form the
   * F9 UI hides from them.
   */
  @Post()
  override async save(@Body() createDto: any, @DecodedToken() token?: AppToken): Promise<OrganizationDocument> {
    const targetOrgId = createDto?._id?.toString?.() ?? createDto?._id ?? createDto?.id;
    if (targetOrgId) {
      await this.assertCanEditSettings(targetOrgId, token);
    }

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
   * The inherited `PUT :id`. Overridden only to carry the permission decorator — the body is the
   * parent's, unchanged.
   */
  @OrgPermission('org:settings', { orgIdParam: 'id' })
  @Put(':id')
  override async partialUpdate(@Param('id') id: string, @Body() partialUpdates: Partial<OrganizationDocument>): Promise<OrganizationDocument> {
    return super.partialUpdate(id, partialUpdates);
  }

  /**
   * The member list of an organization.
   *
   * Guarded from its first commit: it exposes emails and memberships.
   *
   * F11: the role is resolved **in the organization named by `:orgId`**, so being a member somewhere
   * else grants nothing here. Every role has `members:read`, which is what keeps names and avatars
   * rendering for a Viewer instead of falling back to raw emails.
   */
  @OrgPermission('members:read', { orgIdParam: 'orgId' })
  @Get(':orgId/members')
  async getMembers(@Param('orgId') orgId: string, @DecodedToken() token: AppToken) {
    return this.organizationService.getMembers(orgId, token?.email);
  }

  /**
   * @deprecated Use operateUserToOrganization instead
   */
  @OrgPermission('members:manage', { orgIdParam: 'orgId' })
  @Post(':orgId/add-user')
  async addUserToOrganization(@Param('orgId') orgId: string, @Body() addUserToOrganizationDto: AddUserToOrganizationDto, @DecodedToken() token: AppToken) {
    return this.organizationService.addUserToOrganization(orgId, addUserToOrganizationDto.email, undefined, this.requesterFrom(token));
  }

  /**
   * F11: `members:manage` — Owner and Admin only — **except for the two things you do to yourself**.
   *
   * A blanket decorator would have quietly removed two behaviours the earlier phases put there on
   * purpose: F6 decided that changing your own role is forbidden but *leaving* an organization is
   * not, and F7 made your per-organization alias and avatar self-service. Under `members:manage` a
   * Viewer could no longer leave, nor fix their own display name. So the rule is conditional, and
   * the condition is written here rather than hidden in a decorator that cannot express it.
   *
   * The business invariants stay in the service (last owner, no self-promotion, no granting above
   * your own role): they are not authorization, they bind an Owner too, and they also cover the MCP
   * tool `org_operateUser`, which never passes through this guard.
   */
  @Post(':orgId/operate-user')
  async operateUserToOrganization(@Param('orgId') orgId: string, @Body() dto: OrgUserOperationDto, @DecodedToken() token: AppToken) {
    const isSelfService = (dto?.operation === 'remove' || dto?.operation === 'update-profile') && !!token?.email && dto?.email === token.email;
    await this.assertMemberOperationAllowed(orgId, token, isSelfService);
    return this.organizationService.operateUserToOrganization(orgId, dto, this.requesterFrom(token));
  }

  private requesterFrom(token: AppToken): IOrgOperationRequester {
    return { email: token?.email, isPlatformAdmin: isPlatformAdmin(token) };
  }

  /**
   * `members:manage` in the organization of the route — unless the caller is acting on themselves,
   * where being a member of that organization is enough.
   */
  private async assertMemberOperationAllowed(orgId: string, token: AppToken, isSelfService: boolean): Promise<void> {
    const ctx = await this.orgContext.resolve(token, orgId);
    if (ctx.isPlatformAdmin) {
      this.logger.warn(`[ADMIN_BYPASS] organization operate-user | actor=${ctx.email ?? '-'} | orgId=${orgId}`);
      return;
    }
    if (isSelfService) {
      if (!ctx.role) {
        throw new ForbiddenException('You are not a member of this organization.');
      }
      return;
    }
    if (!hasOrgPermission(ctx.role, 'members:manage')) {
      throw new ForbiddenException(`Managing members requires the 'members:manage' permission. Your role there is: ${ctx.role ?? 'none (not a member)'}.`);
    }
  }

  /**
   * `org:settings` in the organization being written, resolved from the body instead of a route
   * param. Platform admin is an explicit, audited bypass — the `/page/admin/organizations` screen
   * edits organizations its operator is not a member of.
   */
  private async assertCanEditSettings(orgId: string, token?: AppToken): Promise<void> {
    const ctx = await this.orgContext.resolve(token, orgId);
    if (ctx.isPlatformAdmin) {
      this.logger.warn(`[ADMIN_BYPASS] organization save | actor=${ctx.email ?? '-'} | orgId=${orgId}`);
      return;
    }
    if (!hasOrgPermission(ctx.role, 'org:settings')) {
      throw new ForbiddenException(`Editing this organization requires the 'org:settings' permission. Your role there is: ${ctx.role ?? 'none (not a member)'}.`);
    }
  }
}
