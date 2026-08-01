import { ForbiddenException } from '@nestjs/common';
import { InboxIdentityService } from './inbox-identity.service';

describe('InboxIdentityService', () => {
  const user = {
    _id: { toString: () => 'mongo-user-1' },
    id: 'user-1',
    fbId: 'firebase-1',
    email: 'ada@example.com',
    urlPicture: 'https://example.com/avatar.png',
    defaultOrgId: 'org-1',
    organizations: [{ orgId: 'org-2', name: 'Shared', roles: ['member'] }],
    personalData: { firstname: 'Ada', lastname: 'Lovelace' },
  };

  function createService(foundUser: any = user) {
    const model = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(foundUser) }),
      }),
    };
    return { service: new InboxIdentityService(model as any), model };
  }

  it('resolves the authenticated user and an allowed organization', async () => {
    const { service } = createService();
    const actor = await service.resolveActor({ email: user.email } as any, 'org-2');

    expect(actor).toEqual({
      orgId: 'org-2',
      userRefId: 'user-1',
      participant: {
        participantId: 'user:user-1',
        type: 'user',
        refId: 'user-1',
        displayName: 'Ada Lovelace',
      },
    });
  });

  it('rejects a forged organization header', async () => {
    const { service } = createService();

    await expect(service.resolveActor({ email: user.email } as any, 'org-attacker')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
