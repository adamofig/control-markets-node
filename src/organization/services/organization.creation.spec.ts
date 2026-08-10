import { EntityCommunicationService } from '@dataclouder/nest-mongo';
import { OrganizationService } from './organization.service';
import { OrgRole } from 'src/user/user.class';

/**
 * The gap the F2 migration exposed: 21 organizations with no resolvable owner, because nothing on
 * the creation path ever wrote one. These tests pin the fix — every organization is born owned.
 */
describe('OrganizationService — creation assigns the owner', () => {
  const ORG_ID = 'org-new';

  function createService(users: any[]) {
    const findUserByEmail = jest.fn(async (email: string) => users.find(u => u.email === email) ?? null);
    const findUserById = jest.fn(async (id: string) => users.find(u => u.id === id) ?? null);
    const updateUser = jest.fn(async (id: string, patch: any) => ({ id, ...patch }));

    const userService: any = { findUserByEmail, findUserById, updateUser };
    const service = new OrganizationService({} as any, {} as any, userService);
    return { service, updateUser };
  }

  function population() {
    return [{ id: 'u-creator', email: 'creator@cm.com', organizations: [] }];
  }

  const savedOrg = { _id: { toString: () => ORG_ID }, name: 'Nueva Org', type: 'team' };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(EntityCommunicationService.prototype, 'save').mockResolvedValue(savedOrg as any);
    jest.spyOn(EntityCommunicationService.prototype, 'executeOperation').mockResolvedValue(savedOrg as any);
  });

  it('makes the creator owner of a brand new organization', async () => {
    const { service, updateUser } = createService(population());

    await service.save({ name: 'Nueva Org', auditable: { createdBy: 'creator@cm.com' } });

    expect(updateUser).toHaveBeenCalledWith('u-creator', {
      organizations: [expect.objectContaining({ orgId: ORG_ID, role: OrgRole.Owner, status: 'active' })],
    });
  });

  it('does not touch memberships when the payload is an update, not a creation', async () => {
    const { service, updateUser } = createService(population());

    await service.save({ id: ORG_ID, name: 'Nueva Org', auditable: { createdBy: 'creator@cm.com' } });

    expect(updateUser).not.toHaveBeenCalled();
  });

  it('covers the operation endpoint used by /api/universal', async () => {
    const { service, updateUser } = createService(population());

    await service.executeOperation({ action: 'create', payload: { name: 'Nueva Org', auditable: { createdBy: 'creator@cm.com' } } } as any);

    expect(updateUser).toHaveBeenCalledWith('u-creator', {
      organizations: [expect.objectContaining({ orgId: ORG_ID, role: OrgRole.Owner })],
    });
  });

  it('leaves a read operation alone', async () => {
    const { service, updateUser } = createService(population());

    await service.executeOperation({ action: 'find', query: {} } as any);

    expect(updateUser).not.toHaveBeenCalled();
  });

  it('resolves the owner of a personal organization by its name, which init writes as the email', async () => {
    const { service, updateUser } = createService(population());
    jest.spyOn(EntityCommunicationService.prototype, 'save').mockResolvedValue({ _id: { toString: () => 'org-personal' }, name: 'creator@cm.com', type: 'personal' } as any);

    await service.save({ name: 'creator@cm.com', type: 'personal' }, 'forced-id');

    expect(updateUser).toHaveBeenCalledWith('u-creator', {
      organizations: [expect.objectContaining({ orgId: 'org-personal', role: OrgRole.Owner })],
    });
  });

  it('promotes an existing membership instead of duplicating it', async () => {
    const users = population();
    users[0].organizations = [{ orgId: ORG_ID, name: 'Nueva Org', role: OrgRole.Member, status: 'active' }];
    const { service, updateUser } = createService(users);

    await service.save({ name: 'Nueva Org', auditable: { createdBy: 'creator@cm.com' } });

    const patch = updateUser.mock.calls[0][1];
    expect(patch.organizations).toHaveLength(1);
    expect(patch.organizations[0].role).toBe(OrgRole.Owner);
  });

  it('creates the organization anyway when the creator cannot be resolved', async () => {
    const { service, updateUser } = createService(population());

    const result = await service.save({ name: 'Nueva Org' });

    expect(result).toBe(savedOrg);
    expect(updateUser).not.toHaveBeenCalled();
  });
});
