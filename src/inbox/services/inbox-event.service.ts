import { Injectable, MessageEvent } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable, Subject, filter, map } from 'rxjs';

export type InboxEventType = 'inbox.conversation.created' | 'inbox.conversation.updated' | 'inbox.membership.updated' | 'inbox.message.created' | 'inbox.message.updated' | 'inbox.message.deleted';

export interface InboxEventEnvelope<T = unknown> {
  id: string;
  version: 1;
  type: InboxEventType;
  orgId: string;
  conversationId?: string;
  occurredAt: string;
  payload: T;
}

interface InboxInternalEvent {
  envelope: InboxEventEnvelope;
  recipientRefIds: string[];
}

@Injectable()
export class InboxEventService {
  private readonly events = new Subject<InboxInternalEvent>();

  emit<T>(type: InboxEventType, orgId: string, conversationId: string | undefined, payload: T, recipientRefIds: string[]): void {
    this.events.next({
      envelope: {
        id: randomUUID(),
        version: 1,
        type,
        orgId,
        conversationId,
        occurredAt: new Date().toISOString(),
        payload,
      },
      recipientRefIds: [...new Set(recipientRefIds)],
    });
  }

  forRecipient(orgId: string, memberRefId: string): Observable<MessageEvent> {
    return this.events.pipe(
      filter(event => event.envelope.orgId === orgId && event.recipientRefIds.includes(memberRefId)),
      map(event => ({ id: event.envelope.id, type: event.envelope.type, data: event.envelope }))
    );
  }
}
