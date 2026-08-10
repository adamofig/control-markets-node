import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { OrganizationEntity, OrganizationDocument } from '../schemas/organization.schema';
import { MongoService } from '@dataclouder/nest-mongo';
import { EntityCommunicationService } from '@dataclouder/nest-mongo';
import { AppUserService } from 'src/user/user.service';
import { IUserOrganization, OrgRole, resolveOrgRole } from 'src/user/user.class';
import { AppException } from '@dataclouder/nest-core';
import { ORG_ROLE_RANK } from 'src/auth/org-permissions';
import { IOrgMemberView, IOrgOperationRequester, OrgUserOperationDto } from '../models/organization-member.models';

/**
 * Service for managing organization entities in the database
 * Provides CRUD operations and query capabilities for OrganizationEntity objects
 */
/**
 * Service for managing organization entities in the database
 * Provides CRUD operations and query capabilities for OrganizationEntity objects
 * @description
 * This service provides methods for creating, retrieving, updating, and deleting organization entities
 * It also provides a query method that takes a filters configuration object and returns a promise resolving to a query response containing results and metadata
 */
@Injectable()
export class OrganizationService extends EntityCommunicationService<OrganizationDocument> {
  private readonly logger = new Logger('OrganizationService');

  constructor(
    @InjectModel(OrganizationEntity.name)
    private organizationModel: Model<OrganizationDocument>,
    mongoService: MongoService,
    private readonly userService: AppUserService
  ) {
    super(organizationModel, mongoService);
  }

  // ---------------------------------------------------------------------------------------------
  // Creation — every organization is born with an owner
  //
  // The F2 migration found 21 organizations with no resolvable owner, all for the same reason:
  // nothing ever wrote `auditable.createdBy`, and the generic CRUD inherited from
  // `EntityCommunicationService` knows nothing about memberships. Without this, every new team
  // organization is born unadministrable the day F11 starts enforcing `members:manage`.
  // ---------------------------------------------------------------------------------------------

  /** `POST /api/organization` and the personal organization created in `init.controller`. */
  public override async save(entity: any, forceId?: string): Promise<OrganizationDocument> {
    const isCreation = !!forceId || !(entity?.id || entity?._id);
    const saved = await super.save(entity, forceId);
    if (isCreation) {
      await this.ensureCreatorIsOwner(saved, entity?.auditable?.createdBy);
    }
    return saved;
  }

  /** `POST /api/organization/operation` and `POST /api/universal/organization/operation` with `action: 'create'`. */
  public override async executeOperation(operation: any): Promise<any> {
    const result = await super.executeOperation(operation);
    if (operation?.action === 'create' && result) {
      await this.ensureCreatorIsOwner(result, operation?.payload?.auditable?.createdBy);
    }
    return result;
  }

  /**
   * Never demotes and never steals: it only fills the gap when the creator has no membership yet,
   * or has one without the owner role. An unresolvable creator is logged, not thrown — the document
   * already exists at this point, and failing the request would leave a half-created organization.
   */
  private async ensureCreatorIsOwner(organization: any, createdBy?: string): Promise<void> {
    const orgId = (organization?._id ?? organization?.id)?.toString();
    if (!orgId) {
      return;
    }

    const owner = await this.resolveCreator(organization, createdBy);
    if (!owner) {
      this.logger.warn(`[ORG_WITHOUT_OWNER] organization ${orgId} created with no resolvable creator (createdBy=${createdBy ?? 'none'})`);
      return;
    }

    const organizations: IUserOrganization[] = [...(owner.organizations ?? [])];
    const existing = organizations.find(org => org.orgId === orgId);
    if (existing && resolveOrgRole(existing) === OrgRole.Owner) {
      return;
    }

    if (existing) {
      existing.role = OrgRole.Owner;
      existing.status = existing.status ?? 'active';
      existing.roles = ['owner'];
    } else {
      organizations.push({
        orgId,
        name: organization.name,
        role: OrgRole.Owner,
        status: 'active',
        joinedAt: new Date(),
        roles: ['owner'], // @deprecated dual-write, removed in F16
      });
    }

    await this.userService.updateUser(owner.id, { organizations });
  }

  /**
   * Personal organizations get a second path on purpose: `init.controller` creates them with the
   * owner's email as `name` and no auditable stamp at all.
   */
  private async resolveCreator(organization: any, createdBy?: string): Promise<any | null> {
    if (createdBy?.includes('@')) {
      const byEmail = await this.userService.findUserByEmail(createdBy);
      if (byEmail) {
        return byEmail;
      }
    } else if (createdBy) {
      const byId = await this.userService.findUserById(createdBy);
      if (byId) {
        return byId;
      }
    }

    if (organization?.type === 'personal' && typeof organization?.name === 'string' && organization.name.includes('@')) {
      return this.userService.findUserByEmail(organization.name);
    }

    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // Members — read
  // ---------------------------------------------------------------------------------------------

  /**
   * The organization's member list, built from the membership index on `users.organizations.orgId`.
   * Returns a projection: exposing the raw user documents here would leak claims, tokens and settings.
   */
  public async getMembers(orgId: string, requesterEmail?: string): Promise<IOrgMemberView[]> {
    const users = await this.userService.findOrgMembers(orgId);

    return users
      .map(user => {
        const membership = user.organizations?.find(org => org.orgId === orgId);
        if (!membership) {
          return null;
        }
        const fullName = [user.personalData?.firstname, user.personalData?.lastname].filter(Boolean).join(' ').trim();
        return {
          userId: user.id || user._id?.toString(),
          email: user.email,
          fullName: fullName || user.email,
          displayName: membership.displayName,
          avatar: membership.avatar,
          urlPicture: user.urlPicture,
          role: resolveOrgRole(membership),
          status: membership.status ?? 'active',
          joinedAt: membership.joinedAt,
          isYou: !!requesterEmail && user.email === requesterEmail,
        } as IOrgMemberView;
      })
      .filter(Boolean);
  }

  /**
   * The organizations a person belongs to, resolved from `users.organizations[]` (F7).
   *
   * Replaces the `{ 'guests.email': email }` query: `guests[]` is dual-written until F16 but is no
   * longer the source of truth, and it never carried the role.
   */
  public async findOrganizationsByUserEmail(email: string): Promise<any[]> {
    const user = await this.userService.findUserByEmail(email);
    const memberships: IUserOrganization[] = (user as any)?.organizations ?? [];
    const orgIds = memberships.map(membership => membership.orgId).filter(orgId => !!orgId && Types.ObjectId.isValid(orgId));
    if (!orgIds.length) {
      return [];
    }

    const organizations = await this.organizationModel.find({ _id: { $in: orgIds } }, { name: 1, type: 1, description: 1 }).lean().exec();
    return organizations.map(organization => {
      const membership = memberships.find(candidate => candidate.orgId === organization._id.toString());
      return { ...organization, role: resolveOrgRole(membership), status: membership?.status ?? 'active' };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Members — write
  // ---------------------------------------------------------------------------------------------

  public async operateUserToOrganization(orgId: string, dto: OrgUserOperationDto, requester: IOrgOperationRequester = { isPlatformAdmin: false }): Promise<any> {
    switch (dto.operation) {
      case 'add':
        return this.addUserToOrganization(orgId, dto.email, dto.role, requester);
      case 'remove':
        return this.removeUserFromOrganization(orgId, dto.email, requester);
      case 'update-role':
        return this.updateMemberRole(orgId, dto.email, dto.role, requester);
      case 'update-profile':
        return this.updateMemberProfile(orgId, dto.email, { displayName: dto.displayName, avatar: dto.avatar }, requester);
      default:
        throw new AppException({ error_message: `Operation ${dto.operation} not supported` });
    }
  }

  /**
   * Adds a member. An email without an account is **invited**, not rejected: the membership is parked
   * on a shell user document and flips to `active` the first time that person signs in
   * (see `AppUserService.findOrRegisterWithToken`).
   */
  public async addUserToOrganization(
    orgId: string,
    email: string,
    role: OrgRole = OrgRole.Member,
    requester: IOrgOperationRequester = { isPlatformAdmin: false }
  ): Promise<any> {
    const organization = await this.getOrganizationOrThrow(orgId);
    await this.assertCanAssignRole(orgId, role, email, requester);

    let user = await this.userService.findUserByEmail(email);
    const isInvitation = !user;
    if (!user) {
      user = await this.userService.createInvitedUser(email);
    }

    const orgIdStr = organization._id.toString();
    const existing = user.organizations?.find((org: IUserOrganization) => org.orgId === orgIdStr);
    if (existing) {
      return user; // already a member — adding twice is a no-op, not an error
    }

    const newOrg: IUserOrganization = {
      orgId: orgIdStr,
      name: organization.name,
      role,
      status: isInvitation ? 'invited' : 'active',
      joinedAt: new Date(),
      roles: [role], // @deprecated dual-write, removed in F16 — keeps a code rollback readable
    };

    const organizations = [...(user.organizations ?? []), newOrg];

    // guests[] stays dual-written until F16: 14 Angular files and 4 backend entry points still read it.
    await this.syncGuestEntry(organization, { userId: user.id, email: user.email });

    return this.userService.updateUser(user.id, { organizations });
  }

  public async updateMemberRole(orgId: string, email: string, role: OrgRole, requester: IOrgOperationRequester): Promise<any> {
    if (!role || !(role in ORG_ROLE_RANK)) {
      throw new AppException({ error_message: `Invalid role '${role}'` });
    }
    await this.getOrganizationOrThrow(orgId);
    await this.assertCanAssignRole(orgId, role, email, requester);

    const { user, membership } = await this.getMembershipOrThrow(orgId, email);
    if (resolveOrgRole(membership) === OrgRole.Owner && role !== OrgRole.Owner) {
      await this.assertNotLastOwner(orgId, email, 'demote');
    }

    const organizations = user.organizations.map((org: IUserOrganization) =>
      org.orgId === orgId ? { ...org, role, roles: [role] } : org
    );
    return this.userService.updateUser(user.id, { organizations });
  }

  /**
   * The per-organization name/avatar override. Migrated here from `organizations.guests[]`.
   *
   * Editing **your own** alias is self-service, available to every member including a Viewer — that
   * is what F7 moved out of `guests[]`. Editing **someone else's** is administration, and until F11
   * this method ignored the requester entirely, so any member could rename any colleague. The rule
   * lives here, not only in the controller, because `org_operateUser` (MCP) reaches this by another path.
   */
  public async updateMemberProfile(
    orgId: string,
    email: string,
    profile: { displayName?: string; avatar?: any },
    requester: IOrgOperationRequester
  ): Promise<any> {
    const { user, membership } = await this.getMembershipOrThrow(orgId, email);
    if (!requester.isPlatformAdmin && requester.email && requester.email !== email) {
      await this.assertRequesterOutranks(orgId, requester, resolveOrgRole(membership));
    }

    const organizations = user.organizations.map((org: IUserOrganization) => {
      if (org.orgId !== orgId) {
        return org;
      }
      const next = { ...org };
      if (profile.displayName !== undefined) next.displayName = profile.displayName;
      if (profile.avatar !== undefined) next.avatar = profile.avatar;
      return next;
    });

    return this.userService.updateUser(user.id, { organizations });
  }

  public async removeUserFromOrganization(orgId: string, email: string, requester: IOrgOperationRequester = { isPlatformAdmin: false }): Promise<any> {
    const user = await this.userService.findUserByEmail(email);
    if (!user) {
      throw new AppException({ error_message: `User with email ${email} not found` });
    }

    const organization = await this.getOrganizationOrThrow(orgId);

    const membership = user.organizations?.find((org: IUserOrganization) => org.orgId === orgId);
    if (membership && resolveOrgRole(membership) === OrgRole.Owner) {
      await this.assertNotLastOwner(orgId, email, 'remove');
    }
    if (!requester.isPlatformAdmin && requester.email && requester.email !== email) {
      await this.assertRequesterOutranks(orgId, requester, resolveOrgRole(membership));
    }

    const organizations = (user.organizations ?? []).filter((org: IUserOrganization) => org.orgId !== orgId);

    let defaultOrgId = user.defaultOrgId;
    if (defaultOrgId === orgId) {
      const personalOrg = await this.organizationModel.findOne({ name: email, type: 'personal' }).exec();
      defaultOrgId = personalOrg ? personalOrg._id.toString() : null;
    }

    if (organization.guests) {
      organization.guests = organization.guests.filter(guest => guest.email !== email);
      await organization.save();
    }

    return this.userService.updateUser(user.id, { organizations, defaultOrgId });
  }

  // ---------------------------------------------------------------------------------------------
  // Business invariants
  //
  // These live in the service, not in a guard, so they also cover the MCP tools (`org_operateUser`)
  // that reach this code by another path. They are business rules, not authorization: an
  // authenticated Admin must not be able to leave an organization without an owner either.
  // ---------------------------------------------------------------------------------------------

  private async assertNotLastOwner(orgId: string, email: string, action: 'remove' | 'demote'): Promise<void> {
    const owners = await this.userService.findOrgMembers(orgId);
    const ownerEmails = owners.filter(user => resolveOrgRole(user.organizations?.find(o => o.orgId === orgId)) === OrgRole.Owner).map(user => user.email);

    if (ownerEmails.length <= 1 && ownerEmails.includes(email)) {
      throw new AppException({
        error_message:
          action === 'remove'
            ? 'No podés quitar al único Owner de la organización. Asigná otro Owner primero.'
            : 'No podés degradar al único Owner de la organización. Asigná otro Owner primero.',
      });
    }
  }

  private async assertCanAssignRole(orgId: string, role: OrgRole, targetEmail: string, requester: IOrgOperationRequester): Promise<void> {
    if (requester.isPlatformAdmin) {
      this.logger.warn(`[PLATFORM_ADMIN_OVERRIDE] ${requester.email ?? 'unknown'} assigned '${role}' to ${targetEmail} in org ${orgId}`);
      return;
    }
    if (!requester.email) {
      return; // no caller context (legacy/system path) — the guard closes this in F11
    }

    if (requester.email === targetEmail) {
      throw new AppException({ error_message: 'No podés cambiar tu propio rol.' });
    }

    const requesterRole = await this.getRequesterRole(orgId, requester.email);
    if (!requesterRole) {
      throw new AppException({ error_message: 'No sos miembro de esta organización.' });
    }
    if (ORG_ROLE_RANK[role] > ORG_ROLE_RANK[requesterRole]) {
      throw new AppException({ error_message: `No podés asignar un rol superior al tuyo (${requesterRole}).` });
    }
  }

  private async assertRequesterOutranks(orgId: string, requester: IOrgOperationRequester, targetRole: OrgRole | null): Promise<void> {
    const requesterRole = await this.getRequesterRole(orgId, requester.email);
    if (!requesterRole) {
      throw new AppException({ error_message: 'No sos miembro de esta organización.' });
    }
    if (targetRole && ORG_ROLE_RANK[targetRole] > ORG_ROLE_RANK[requesterRole]) {
      throw new AppException({ error_message: `No podés operar sobre un miembro de rol superior al tuyo (${requesterRole}).` });
    }
  }

  private async getRequesterRole(orgId: string, email: string): Promise<OrgRole | null> {
    const requesterUser = await this.userService.findUserByEmail(email);
    return resolveOrgRole(requesterUser?.organizations?.find((org: IUserOrganization) => org.orgId === orgId));
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  private async getOrganizationOrThrow(orgId: string): Promise<OrganizationDocument> {
    const organization = await this.organizationModel.findById(orgId).exec();
    if (!organization) {
      throw new AppException({ error_message: `Organization with id ${orgId} not found` });
    }
    return organization;
  }

  private async getMembershipOrThrow(orgId: string, email: string): Promise<{ user: any; membership: IUserOrganization }> {
    const user = await this.userService.findUserByEmail(email);
    if (!user) {
      throw new AppException({ error_message: `User with email ${email} not found` });
    }
    const membership = user.organizations?.find((org: IUserOrganization) => org.orgId === orgId);
    if (!membership) {
      throw new AppException({ error_message: `${email} is not a member of this organization` });
    }
    return { user, membership };
  }

  private async syncGuestEntry(organization: OrganizationDocument, guest: { userId: string; email: string }): Promise<void> {
    if (!organization.guests) {
      organization.guests = [];
    }
    if (organization.guests.some(existing => existing?.email === guest.email)) {
      return;
    }
    organization.guests.push(guest);
    await organization.save();
  }
}
