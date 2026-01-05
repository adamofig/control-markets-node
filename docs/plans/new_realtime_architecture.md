# New Real-time Architecture Plan

This document outlines the strategy for moving from a Firebase-dependent synchronization layer to a self-hosted, scalable, and open-source architecture using **Server-Sent Events (SSE)** and **Redis**.

## Current Architecture & Limitations

Currently, the system uses two layers:
1.  **Creative Flowboard**: Manages canvas state (nodes, edges, positions).
2.  **Execution Flow**: Manages real-time data about which layers/nodes are being executed.

### Existing Sync Process
- **Persistence**: Data is saved in both MongoDB and Firebase (Firestore).
- **Client Subscription**: Angular clients subscribe to Firestore collections.
- **Constraints**: 
    - Dependency on Google Cloud/Firebase prevents easy local/offline installation.
    - Double-writing to Mongo and Firebase adds latency and potential for state divergence.

---

## Proposed Architecture: The Hybrid SSE + Redis Hub

Our goal is to create a "docker-compose ready" solution that can run on any local server without external dependencies.

### 1. The Real-time Hub (Redis Pub/Sub)
We will use **Redis** as the centralized message bus. This allows our backend to be horizontal-scalable (multiple NestJS instances) while maintaining a unified event stream.

- **Publisher**: Any service modifying state (CRUD or Execution) emits an event to a specific Redis channel (e.g., `flow:{id}`).
- **Subscriber**: The SSE Service listens to these channels and pushes data to connected clients.

### 2. Synchronization Layer (SSE)
We utilize standard **Server-Sent Events** for one-way (Server -> Client) communication. This is chosen over WebSockets because most canvas interactions are triggered by REST calls, and we only need to push "completion" or "update" signals back to the UI.

### 3. Event Types
| Event Name | Trigger | Payload |
| :--- | :--- | :--- |
| `SYNC_CANVAS` | Node added/moved, Edge modified | Updated Node/Edge objects |
| `EXECUTION_UPDATE` | Job status change (In-progress, Completed) | `IFlowExecutionState` diff |
| `LOG_STREAM` | LLM output partial results | String chunks/Partial JSON |

---

## Alternative Possibilities Analyzed

### Option A: Socket.io (Bi-directional)
- **Use Case**: Collaborative editing (multi-user cursor tracking) and low-latency bidirectional chat.
- **Decision**: Deferred. SSE is currently sufficient and less infrastructure-intensive.

### Option B: MongoDB Change Streams
- **Use Case**: Automatically syncing any database change directly to the clients.
- **Pros**: Captures changes from external tools (n8n, direct DB edits).
- **Cons**: Requires MongoDB Replica Sets; harder to filter "private" or "internal" state changes before they hit the frontend.

### Option C: Shared State with CRDTs (y-js)
- **Use Case**: High-conflict resolution in multi-user environments.
- **Decision**: Overkill for the current single-user sessions or simple "last-write-wins" requirements.

### Option D: SSE with Local EventEmitter (No Redis)
- **Use Case**: Single-instance deployment, minimal infrastructure.
- **Pros**: Zero external dependencies; extremely fast; already partially implemented in `FlowEventsService`.
- **Cons**: Not horizontally scalable (events only reach clients connected to the specific instance that emitted the event).
- **Decision**: Recommended as the first step for local/Docker development.

---

## Implementation Roadmap (Internal)

1.  **Infrastructure**: Add Redis container to `docker-compose.yml`.
2.  **Core Service**: Implement `FlowEventsService` with `ioredis` Pub/Sub.
3.  **Controller**: Standardize the `@Sse('subscribe/:id')` endpoint in `CreativeFlowboardController`.
4.  **Integration**: 
    - Replace Firestore logs in `FlowRunnerService` with Redis emits.
    - Add event emission to `CreativeFlowboardService.addNodes()`.
5.  **Frontend**: Update Angular `FlowEventsService` to handle standard SSE streams instead of Firebase Observables.
