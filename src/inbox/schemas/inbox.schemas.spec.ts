import { model } from 'mongoose';
import { InboxConversationSchema } from './inbox-conversation.schema';
import { InboxMembershipSchema } from './inbox-membership.schema';
import { InboxMessageSchema } from './inbox-message.schema';

describe('Control Inbox schemas', () => {
  const ConversationModel = model('InboxConversationSchemaSpec', InboxConversationSchema.clone());
  const MembershipModel = model('InboxMembershipSchemaSpec', InboxMembershipSchema.clone());
  const MessageModel = model('InboxMessageSchemaSpec', InboxMessageSchema.clone());

  it('builds valid conversation, membership and message documents with defaults', () => {
    const conversation = new ConversationModel({
      orgId: 'org-1',
      type: 'direct',
      participants: [
        { participantId: 'participant-1', type: 'user', refId: 'user-1', displayName: 'Ada' },
        { participantId: 'participant-2', type: 'user', refId: 'user-2', displayName: 'Grace' },
      ],
      participantRefIds: ['user-1', 'user-2'],
      dedupeKey: 'direct:user-1:user-2',
    });
    const membership = new MembershipModel({
      orgId: 'org-1',
      conversationId: 'conversation-1',
      participantId: 'participant-1',
      memberType: 'user',
      memberRefId: 'user-1',
      role: 'owner',
    });
    const message = new MessageModel({
      orgId: 'org-1',
      conversationId: 'conversation-1',
      sequence: 1,
      senderParticipantId: 'participant-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello', format: 'plain' }],
    });

    expect(conversation.validateSync()).toBeUndefined();
    expect(conversation.status).toBe('open');
    expect(conversation.lastMessageSequence).toBe(0);
    expect(conversation.messageCount).toBe(0);

    expect(membership.validateSync()).toBeUndefined();
    expect(membership.lastReadSequence).toBe(0);
    expect(membership.unreadCount).toBe(0);
    expect(membership.joinedAt).toBeInstanceOf(Date);

    expect(message.validateSync()).toBeUndefined();
    expect(message.kind).toBe('message');
    expect(message.status).toBe('sent');
    expect(message.origin).toMatchObject({ channel: 'internal' });
  });

  it('rejects invalid enum values at runtime', () => {
    const conversation = new ConversationModel({
      orgId: 'org-1',
      type: 'task_thread',
      participants: [],
      participantRefIds: [],
    });
    const membership = new MembershipModel({
      orgId: 'org-1',
      conversationId: 'conversation-1',
      participantId: 'participant-1',
      memberType: 'browser_session',
      memberRefId: 'user-1',
      role: 'owner',
    });
    const message = new MessageModel({
      orgId: 'org-1',
      conversationId: 'conversation-1',
      sequence: 1,
      senderParticipantId: 'participant-1',
      role: 'human',
      parts: [{ type: 'html', text: '<b>unsafe</b>' }],
    });

    expect(conversation.validateSync()?.errors.type).toBeDefined();
    expect(membership.validateSync()?.errors.memberType).toBeDefined();
    expect(message.validateSync()?.errors.role).toBeDefined();
    expect(message.validateSync()?.errors['parts.0.type']).toBeDefined();
  });

  it('declares the tenant-scoped uniqueness and listing indexes', () => {
    const conversationIndexes = InboxConversationSchema.indexes();
    const membershipIndexes = InboxMembershipSchema.indexes();
    const messageIndexes = InboxMessageSchema.indexes();

    expect(conversationIndexes).toEqual(
      expect.arrayContaining([
        [{ orgId: 1, dedupeKey: 1 }, expect.objectContaining({ unique: true })],
        [{ orgId: 1, participantRefIds: 1, updatedAt: -1 }, expect.any(Object)],
      ])
    );
    expect(membershipIndexes).toEqual(
      expect.arrayContaining([
        [{ orgId: 1, conversationId: 1, memberRefId: 1 }, expect.objectContaining({ unique: true })],
        [{ orgId: 1, memberRefId: 1, archivedAt: 1, updatedAt: -1 }, expect.any(Object)],
      ])
    );
    expect(messageIndexes).toEqual(
      expect.arrayContaining([
        [{ orgId: 1, conversationId: 1, sequence: -1 }, expect.objectContaining({ unique: true })],
        [{ orgId: 1, conversationId: 1, clientMessageId: 1 }, expect.objectContaining({ unique: true })],
      ])
    );
  });
});
