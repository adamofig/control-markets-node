import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { InboxMessageService } from './inbox-message.service';

describe('InboxMessageService', () => {
  const membership = {
    participantId: 'user:user-1',
    memberRefId: 'user-1',
    memberType: 'user',
  };

  function queryResult<T>(value: T) {
    return { lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(value) }) };
  }

  function createService(options: { membership?: any; existingMessage?: any } = {}) {
    const conversationModel = {
      exists: jest.fn().mockResolvedValue(true),
      findOneAndUpdate: jest.fn(),
    };
    const membershipModel = {
      findOne: jest.fn().mockReturnValue(queryResult(options.membership === undefined ? membership : options.membership)),
    };
    const messageModel = {
      findOne: jest.fn().mockReturnValue(queryResult(options.existingMessage ?? null)),
    };
    const service = new InboxMessageService(conversationModel as any, membershipModel as any, messageModel as any, {} as any, {} as any);
    return { service, conversationModel, membershipModel, messageModel };
  }

  it('returns the durable message when a clientMessageId is retried', async () => {
    const existingMessage = {
      id: 'message-1',
      orgId: 'org-1',
      conversationId: 'conversation-1',
      sequence: 1,
      clientMessageId: 'client-1',
      senderParticipantId: membership.participantId,
      role: 'user',
      kind: 'message',
      status: 'sent',
      parts: [{ type: 'text', text: 'Hello', format: 'plain' }],
    };
    const { service, conversationModel } = createService({ existingMessage });

    const result = await service.send('org-1', 'conversation-1', 'user-1', {
      clientMessageId: 'client-1',
      parts: [{ type: 'text', text: 'Hello', format: 'plain' }],
    });

    expect(result.message).toMatchObject(existingMessage);
    expect(conversationModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects writes from users without an active membership', async () => {
    const { service } = createService({ membership: null });

    await expect(
      service.send('org-1', 'conversation-1', 'user-attacker', {
        clientMessageId: 'client-1',
        parts: [{ type: 'text', text: 'Hello', format: 'plain' }],
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects empty text before allocating a sequence', async () => {
    const { service, conversationModel } = createService();

    await expect(
      service.send('org-1', 'conversation-1', 'user-1', {
        clientMessageId: 'client-1',
        parts: [{ type: 'text', text: '   ', format: 'plain' }],
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(conversationModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
