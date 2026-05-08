# Connecting Angular to Real-time Flow Events

This guide explains how to connect an Angular frontend to the NestJS SSE (Server-Sent Events) stream to receive real-time updates for flow execution and canvas synchronization.

## 1. The SSE Endpoint

The backend provides a subscription endpoint per flow:
`GET /api/creative-flowboard/subscribe/:flowId`

## 2. Basic Connection with `EventSource`

The simplest way is using the browser's native `EventSource`.

```typescript
import { Injectable, NgZone } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class FlowEventsService {
  constructor(private zone: NgZone) {}

  subscribeToFlow(flowId: string): Observable<any> {
    return new Observable(observer => {
      const eventSource = new EventSource(`/api/creative-flowboard/subscribe/${flowId}`);

      eventSource.onmessage = (event) => {
        // Run inside NgZone to ensure change detection works
        this.zone.run(() => {
          const data = JSON.parse(event.data);
          observer.next(data);
        });
      };

      eventSource.onerror = (error) => {
        this.zone.run(() => {
          observer.error(error);
        });
      };

      return () => {
        eventSource.close();
      };
    });
  }
}
```

## 3. Ideal Event Handling (Recommended)

To handle different types of events (execution updates vs. canvas changes), we should use a structured event payload.

### Expected Payload Structure
Ideally, the backend should send:
```json
{
  "event": "EXECUTION_UPDATE" | "SYNC_CANVAS",
  "payload": { ...Data... }
}
```

### Advanced Frontend Implementation
If you need to pass Auth Tokens (which standard `EventSource` doesn't support for headers), use the `event-source-polyfill` library.

```typescript
// With event-source-polyfill
import { EventSourcePolyfill } from 'event-source-polyfill';

const eventSource = new EventSourcePolyfill(`/api/creative-flowboard/subscribe/${flowId}`, {
  headers: {
    'Authorization': 'Bearer ' + token
  }
});
```

## 4. How it should work ideally (Future Proof)

1.  **Multiple Channels**: The backend should emit to the `flowId` (the diagram ID) common channel for all general status updates.
2.  **Fine-grained events**: Instead of sending the full flow state every time, send "diffs" or specific event types:
    *   `node:started`: `{ nodeId: '123' }`
    *   `node:completed`: `{ nodeId: '123', result: '...' }`
    *   `canvas:node_moved`: `{ nodeId: '123', point: { x: 10, y: 20 } }`

3.  **State Management**: In Angular, pipe these events into your state management (e.g., NGXS, NGRX, or simple Signals) to update the canvas UI dynamically.

---

## 5. Current Implementation Status (Warning)

> [!IMPORTANT]
> Currently, the `FlowRunnerService` is emitting events to a random **Execution ID** instead of the **Flow ID**.
> 
> **To fix this on the backend:**
> Change `FlowRunnerService.ts`:
> ```typescript
> // From:
> this.flowEventsService.emit(flowExecutionState.id, flowExecutionState);
> // To:
> this.flowEventsService.emit(flowExecutionState.flowId, flowExecutionState);
> ```
