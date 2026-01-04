### Real-Time Synchronization Strategy for Frontend and Backend

This document outlines the technical process for establishing real-time data synchronization between the Angular frontend and the NestJS backend.

The primary object requiring synchronization is the `ICreativeFlowBoard`, which represents the user's workflow canvas. The core operations involve updating nodes (`IFlowNode`) and edges (`IFlowEdge`).

### Core Concepts and Problem Statement

Two distinct states are involved in the agent flow process:

1.  **Canvas Diagram State**: This represents the structure of the workflow, including the nodes, their connections, and their positions on the canvas. This is the state that users actively build and modify.
2.  **Execution State**: This reflects the real-time status of a running flow (e.g., which node is currently executing). This is already synchronized effectively using Firestore, which provides excellent real-time capabilities that the frontend subscribes to.

The central challenge lies with the **Canvas Diagram State**. Currently, the backend is stateless, meaning it does not retain any application state between requests. The canvas state is managed entirely on the frontend and is only persisted to MongoDB when the user manually saves their work. This architecture prevents real-time collaboration and data consistency across different sessions or users.

### Chosen Architecture: Server-Sent Events (SSE)

To solve this problem, we will implement a real-time synchronization mechanism using **Server-Sent Events (SSE)**.

#### Why Server-Sent Events?

SSE was chosen over other solutions like WebSockets (Socket.IO) or extending the Firestore implementation for several key reasons:

*   **Stateless Backend Compatibility**: SSE allows the server to push updates to the client without requiring the backend to become stateful. This aligns perfectly with our existing stateless architecture, minimizing complexity and avoiding a major redesign.
*   **Simplicity and Efficiency**: SSE is a simpler protocol than WebSockets and is built on standard HTTP. It is highly efficient for one-way communication (server-to-client), which is exactly what is needed to notify the frontend of changes.
*   **Existing Implementation**: The backend already has a foundational SSE endpoint in the [`AgentFlowsController`](../controllers/agent-flows.controller.ts), making this a natural and low-friction extension of our current code.

### Implementation Strategy

The synchronization will be event-driven. The frontend will notify the backend of changes via standard REST API calls, and the backend will broadcast these changes to all subscribed clients via SSE.

#### 1. Backend Implementation

*   **Create REST Endpoints**: We will introduce new endpoints in the [`AgentFlowsController`](../controllers/agent-flows.controller.ts) to handle CRUD operations for nodes and edges (e.g., `POST /api/agent-flows/:id/nodes`, `PUT /api/agent-flows/:id/nodes/:nodeId`).
*   **Process and Broadcast Events**: When one of these endpoints receives a request, the following will occur:
    1.  The data will be validated and persisted to the MongoDB database.
    2.  Upon successful persistence, the [`FlowEventsService`](../services/flow-events.service.ts) will be used to emit an event (e.g., `node_created`, `edge_updated`) to a channel specific to the `flowId`.
    3.  The event payload will contain the updated data.

#### 2. Frontend Implementation

*   **Subscribe to Events**: When a user opens a flow canvas, the Angular component will establish an SSE connection to the `/api/agent-flows/subscribe/:id` endpoint.
*   **Handle Incoming Events**: The frontend will listen for specific events from the server. When an event is received, it will update the local state of the canvas, ensuring the UI reflects the change in real-time without needing a manual refresh.
*   **Send Updates**: When the user modifies the canvas (e.g., adds a node), the frontend will call the appropriate new REST endpoint on the backend to persist the change.

#### Synchronization Flow Diagram

The following diagram illustrates the process when an external system (like n8n) or another user creates a new node.

```mermaid
sequenceDiagram
    participant Client as External System / User B
    participant Backend as Agent Flows API
    participant Database as MongoDB
    participant Frontend as User A's Browser

    Client->>+Backend: POST /api/agent-flows/{id}/nodes (new node data)
    Backend->>+Database: Save new node
    Database-->>-Backend: Confirm save
    Backend->>Backend: flowEventsService.emit({id}, 'node_created', newNode)
    Backend-->>-Client: 201 Created (Response)

    Note over Backend,Frontend: SSE Connection is already open for {id}
    Backend-->>Frontend: SSE Event: { data: { event: 'node_created', payload: newNode } }
    Frontend->>Frontend: Update canvas with new node
