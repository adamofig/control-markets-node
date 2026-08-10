import { OrganizationService } from './organization.service';
import { OrgRole } from 'src/user/user.class';
import { IOrgOperationRequester } from '../models/organization-member.models';

/**
 * The business invariants of F3. They live in the service — not in a guard — so they also cover the
 * MCP tools that reach this code by another path, and they apply before the F11 guard exists.
 */
describe('OrganizationService — member invariants', () => {
  const ORG_ID = 'org-1';

  const organization: any = {
    _id: { toString: () => ORG_ID },
    name: 'Control Markets',
    guests: [],
    save: jest.fn().mockResolvedValue(undefined),
  };

  function membership(role: OrgRole, extra: Record<string, any> = {}) {
    return { orgId: ORG_ID, name: organization.name, role, status: 'active', ...extra };
  }

  /** `users` is the whole tenant population the fake user service answers from. */
  function createService(users: any[]) {
    const findUserByEmail = jest.fn(async (email: string) => users.find(u => u.email === email) ?? null);
    const findOrgMembers = jest.fn(async (orgId: string) => users.filter(u => u.organizations?.some((o: any) => o.orgId === orgId)));
    const updateUser = jest.fn(async (id: string, patch: any) => ({ id, ...patch }));
    const createInvitedUser = jest.fn(async (email: string) => {
      const created = { id: `new-${email}`, email, organizations: [] };
      users.push(created);
      return created;
    });

    const userService: any = { findUserByEmail, findOrgMembers, updateUser, createInvitedUser };
    const organizationModel: any = {
      findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(organization) }),
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    };

    const service = new OrganizationService(organizationModel, {} as any, userService);
    return { service, updateUser, createInvitedUser };
  }

  const asOwner: IOrgOperationRequester = { email: 'owner@cm.com', isPlatformAdmin: false };
  const asAdmin: IOrgOperationRequester = { email: 'admin@cm.com', isPlatformAdmin: false };

  function population() {
    return [
      { id: 'u-owner', email: 'owner@cm.com', organizations: [membership(OrgRole.Owner)] },
      { id: 'u-admin', email: 'admin@cm.com', organizations: [membership(OrgRole.Admin)] },
      { id: 'u-member', email: 'member@cm.com', organizations: [membership(OrgRole.Member)] },
    ];
  }

  beforeEach(() => {
    organization.guests = [];
    jest.clearAllMocks();
  });

  it('refuses to demote the only owner', async () => {
    const { service } = createService(population());
    await expect(service.operateUserToOrganization(ORG_ID, { email: 'owner@cm.com', operation: 'update-role', role: OrgRole.Member }, asAdmin)).rejects.toThrow();
  });

  it('refuses to remove the only owner', async () => {
    const { service } = createService(population());
    await expect(service.operateUserToOrganization(ORG_ID, { email: 'owner@cm.com', operation: 'remove' }, asAdmin)).rejects.toThrow();
  });

  it('allows demoting an owner once a second owner exists', async () => {
    const users = population();
    users[1].organizations = [membership(OrgRole.Owner)]; // admin@cm.com promoted beforehand
    const { service, updateUser } = createService(users);

    await service.operateUserToOrganization(ORG_ID, { email: 'admin@cm.com', operation: 'update-role', role: OrgRole.Member }, asOwner);

    expect(updateUser).toHaveBeenCalledWith('u-admin', expect.objectContaining({ organizations: [expect.objectContaining({ role: OrgRole.Member })] }));
  });

  it('refuses to grant a role above the requester own', async () => {
    const { service } = createService(population());
    await expect(service.operateUserToOrganization(ORG_ID, { email: 'member@cm.com', operation: 'update-role', role: OrgRole.Owner }, asAdmin)).rejects.toThrow();
  });

  it('refuses a self role change', async () => {
    const { service } = createService(population());
    await expect(service.operateUserToOrganization(ORG_ID, { email: 'admin@cm.com', operation: 'update-role', role: OrgRole.Owner }, asAdmin)).rejects.toThrow();
  });

  it('refuses an operation from someone who is not a member', async () => {
    const { service } = createService(population());
    const outsider: IOrgOperationRequester = { email: 'stranger@other.com', isPlatformAdmin: false };
    await expect(service.operateUserToOrganization(ORG_ID, { email: 'member@cm.com', operation: 'update-role', role: OrgRole.Member }, outsider)).rejects.toThrow();
  });

  it('lets a platform admin bypass the hierarchy but never the last-owner rule', async () => {
    const platform: IOrgOperationRequester = { email: 'support@cm.com', isPlatformAdmin: true };
    const { service, updateUser } = createService(population());

    await service.operateUserToOrganization(ORG_ID, { email: 'member@cm.com', operation: 'update-role', role: OrgRole.Owner }, platform);
    expect(updateUser).toHaveBeenCalledWith('u-member', expect.objectContaining({ organizations: [expect.objectContaining({ role: OrgRole.Owner })] }));

    const fresh = createService(population());
    await expect(fresh.service.operateUserToOrganization(ORG_ID, { email: 'owner@cm.com', operation: 'remove' }, platform)).rejects.toThrow();
  });

  it('invites an email with no account instead of failing with User not found', async () => {
    const { service, createInvitedUser, updateUser } = createService(population());

    await service.operateUserToOrganization(ORG_ID, { email: 'nobody@nowhere.com', operation: 'add', role: OrgRole.Member }, asOwner);

    expect(createInvitedUser).toHaveBeenCalledWith('nobody@nowhere.com');
    expect(updateUser).toHaveBeenCalledWith('new-nobody@nowhere.com', expect.objectContaining({ organizations: [expect.objectContaining({ status: 'invited', role: OrgRole.Member })] }));
  });

  it('adds an existing user as active and dual-writes the deprecated guests[] entry', async () => {
    const users = population();
    users.push({ id: 'u-new', email: 'new@cm.com', organizations: [] });
    const { service, updateUser } = createService(users);

    await service.operateUserToOrganization(ORG_ID, { email: 'new@cm.com', operation: 'add' }, asOwner);

    expect(updateUser).toHaveBeenCalledWith('u-new', expect.objectContaining({ organizations: [expect.objectContaining({ status: 'active', role: OrgRole.Member, roles: [OrgRole.Member] })] }));
    expect(organization.guests).toEqual([{ userId: 'u-new', email: 'new@cm.com' }]);
  });

  it('stores the per-organization name and avatar override on the membership', async () => {
    const { service, updateUser } = createService(population());

    await service.operateUserToOrganization(ORG_ID, { email: 'member@cm.com', operation: 'update-profile', displayName: 'Fulano', avatar: { url: 'x' } }, asOwner);

    expect(updateUser).toHaveBeenCalledWith('u-member', expect.objectContaining({ organizations: [expect.objectContaining({ displayName: 'Fulano', avatar: { url: 'x' } })] }));
  });

  it('lets a member edit their own alias — self-service since F7, kept intact by F11', async () => {
    const { service, updateUser } = createService(population());
    const asMember: IOrgOperationRequester = { email: 'member@cm.com', isPlatformAdmin: false };

    await service.operateUserToOrganization(ORG_ID, { email: 'member@cm.com', operation: 'update-profile', displayName: 'Yo mismo' }, asMember);

    expect(updateUser).toHaveBeenCalledWith('u-member', expect.objectContaining({ organizations: [expect.objectContaining({ displayName: 'Yo mismo' })] }));
  });

  it('refuses to rename a member of a higher rank — before F11 anyone could rename anyone', async () => {
    const { service } = createService(population());
    const asMember: IOrgOperationRequester = { email: 'member@cm.com', isPlatformAdmin: false };

    await expect(
      service.operateUserToOrganization(ORG_ID, { email: 'owner@cm.com', operation: 'update-profile', displayName: 'Pwned' }, asMember)
    ).rejects.toBeDefined();
  });

  it('projects members without leaking the user document', async () => {
    const users = population();
    users[2].organizations = [membership(OrgRole.Member, { displayName: 'Fulano' })];
    (users[2] as any).personalData = { firstname: 'Juan', lastname: 'Perez' };
    (users[2] as any).claims = { roles: { admin: null } };
    const { service } = createService(users);

    const members = await service.getMembers(ORG_ID, 'admin@cm.com');
    const member = members.find(m => m.email === 'member@cm.com');

    expect(member).toMatchObject({ userId: 'u-member', fullName: 'Juan Perez', displayName: 'Fulano', role: OrgRole.Member, status: 'active', isYou: false });
    expect(member).not.toHaveProperty('claims');
    expect(members.find(m => m.email === 'admin@cm.com')?.isYou).toBe(true);
  });

  it('treats a membership written before the migration as a member', async () => {
    const users = population();
    users[2].organizations = [{ orgId: ORG_ID, name: organization.name } as any]; // no role yet
    const { service } = createService(users);

    const members = await service.getMembers(ORG_ID);

    expect(members.find(m => m.email === 'member@cm.com')?.role).toBe(OrgRole.Member);
  });
});

/**
 * F7 — `org_findByUser` dejó de consultar `{ 'guests.email': email }`. La membresía es la fuente de
 * verdad, y además trae el rol, que `guests[]` nunca tuvo.
 */
describe('OrganizationService — organizations of a user', () => {
  const ORG_A = '6a27c95e18f26467e443f298';
  const ORG_B = '6a27c95e18f26467e443f299';

  function createService(user: any, organizations: any[]) {
    const userService: any = { findUserByEmail: jest.fn(async () => user) };
    const organizationModel: any = {
      find: jest.fn().mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(organizations) }) }),
    };
    return { service: new OrganizationService(organizationModel, {} as any, userService), organizationModel };
  }

  it('resolves the organizations from the memberships and carries the role', async () => {
    const user = {
      email: 'someone@cm.com',
      organizations: [
        { orgId: ORG_A, name: 'A', role: OrgRole.Admin, status: 'active' },
        { orgId: ORG_B, name: 'B' }, // pre-migration: no role
      ],
    };
    const { service, organizationModel } = createService(user, [
      { _id: { toString: () => ORG_A }, name: 'A' },
      { _id: { toString: () => ORG_B }, name: 'B' },
    ]);

    const result = await service.findOrganizationsByUserEmail('someone@cm.com');

    expect(organizationModel.find).toHaveBeenCalledWith({ _id: { $in: [ORG_A, ORG_B] } }, expect.any(Object));
    expect(result).toEqual([expect.objectContaining({ name: 'A', role: OrgRole.Admin }), expect.objectContaining({ name: 'B', role: OrgRole.Member })]);
  });

  it('returns nothing — and does not hit mongo — for someone with no memberships', async () => {
    const { service, organizationModel } = createService({ email: 'nobody@cm.com', organizations: [] }, []);

    await expect(service.findOrganizationsByUserEmail('nobody@cm.com')).resolves.toEqual([]);
    expect(organizationModel.find).not.toHaveBeenCalled();
  });

  it('skips membership ids that are not valid ObjectIds instead of throwing a cast error', async () => {
    const user = { email: 'legacy@cm.com', organizations: [{ orgId: 'not-an-object-id', name: 'Legacy' }] };
    const { service, organizationModel } = createService(user, []);

    await expect(service.findOrganizationsByUserEmail('legacy@cm.com')).resolves.toEqual([]);
    expect(organizationModel.find).not.toHaveBeenCalled();
  });
});
