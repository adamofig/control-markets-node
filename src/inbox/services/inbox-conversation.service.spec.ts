import { InboxConversationService } from './inbox-conversation.service';

describe('InboxConversationService', () => {
  function leanResult<T>(value: T) {
    return { lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(value) }) };
  }

  it('creates one deterministic direct thread and memberships for both users', async () => {
    const actor = { participantId: 'user:user-b', type: 'user' as const, refId: 'user-b', displayName: 'Bea' };
    const target = { participantId: 'user:user-a', type: 'user' as const, refId: 'user-a', displayName: 'Ada' };
    let savedConversation: any;
    const conversationModel: any = jest.fn().mockImplementation((value: any) => ({
      ...value,
      save: jest.fn().mockImplementation(async function (this: any) {
        savedConversation = this;
        return this;
      }),
    }));
    conversationModel.findOne = jest
      .fn()
      .mockReturnValueOnce(leanResult(null))
      .mockImplementation(() => leanResult(savedConversation));

    const membership = {
      id: 'membership-b',
      conversationId: 'conversation-1',
      participantId: actor.participantId,
      memberRefId: actor.refId,
      role: 'owner',
    };
    const membershipModel = {
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ acknowledged: true }) }),
      findOne: jest.fn().mockReturnValue(leanResult(membership)),
    };
    const events = { emit: jest.fn() };
    const service = new InboxConversationService(conversationModel, membershipModel as any, events as any);

    const result = await service.getOrCreateDirect('org-1', actor, target);

    expect(savedConversation.dedupeKey).toBe('direct:user-a:user-b');
    expect(savedConversation.participantRefIds).toEqual(['user-a', 'user-b']);
    expect(membershipModel.updateOne).toHaveBeenCalledTimes(2);
    expect(membershipModel.updateOne).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', memberRefId: 'user-a' }), expect.any(Object), { upsert: true });
    expect(membershipModel.updateOne).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', memberRefId: 'user-b' }), expect.any(Object), { upsert: true });
    expect(result.conversation.dedupeKey).toBe('direct:user-a:user-b');
    expect(events.emit).toHaveBeenCalledWith('inbox.conversation.created', 'org-1', expect.any(String), expect.any(Object), ['user-a', 'user-b']);
  });
});
