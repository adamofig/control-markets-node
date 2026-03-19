# Run-Node Communication Flow

This document covers the full lifecycle of a node execution request: from the HTTP call that triggers it, through the backend processing pipeline, to the real-time status updates pushed to the frontend via SSE.

---

## Overview

Running a node is a two-channel operation:

1. **HTTP POST** — triggers the execution and returns immediately.
2. **SSE subscription** — streams live `IFlowExecutionState` updates back to the client as jobs progress.

```
Frontend                        Backend
   |                               |
   |-- POST /run-node -----------> |  (triggers async execution)
   |<- 200 { jobId, ... } -------- |
   |                               |
   |-- GET /subscribe/:flowId ---> |  (SSE connection, stays open)
   |<- data: { tasks, status } --- |  (emitted on every state change)
   |<- data: { tasks, status } --- |  (job IN_PROGRESS → COMPLETED/FAILED)
   |<- data: { tasks, status } --- |
```

---

## 1. Triggering Execution

### Endpoint: `POST /api/creative-flowboard/run-node`

**Body:**
```json
{
  "flowId": "<mongo flow id>",
  "nodeId": "<id of the process node to run>"
}
```

**Controller** → [creative-flowboard.controller.ts](../../src/creative-flowboard/controllers/creative-flowboard.controller.ts)

```typescript
@Post('run-node')
async runNodePost(@Body() body: { flowId: string; nodeId: string }): Promise<any> {
  return await this.creativeFlowboardService.runNodev2(body.flowId, body.nodeId);
}
```

**Service** → `CreativeFlowboardService.runNodev2()`:
1. Loads the flow diagram from MongoDB.
2. Calls `FlowStateService` to build the `IFlowExecutionState` (the execution plan).
3. Persists the initial state.
4. Fires `FlowRunnerService.initExecution()` **without awaiting** (fire-and-forget) so the HTTP response returns immediately.
5. Returns the new `flowExecutionId` to the frontend.

---

## 2. Execution State Hierarchy

Before understanding the event stream, it helps to understand the data model:

```
IFlowExecutionState          (one per flow run)
  └── ITaskExecutionState[]  (one per process node, e.g. VideoGenNode)
        └── IJobExecutionState[]  (one per input connected to that process node)
```

| Level | Owned by | Key fields |
|-------|----------|-----------|
| Flow  | `FlowRunnerService` | `status`, `flowId` |
| Task  | `FlowRunnerService` | `status`, `statusDescription`, `processNodeId` |
| Job   | Node Processor | `status`, `statusDescription`, `outputEntityId`, `resultType` |

All three levels carry a `status: StatusJob` (`pending` → `in_progress` → `completed` / `failed`).
`statusDescription` holds the error message when `status === 'failed'`.

---

## 3. The Execution Loop (`FlowRunnerService`)

File: [flow-runner.service.ts](../../src/creative-flowboard/services/flow-runner.service.ts)

```
initExecution(flowDiagram, flowExecutionState)
  │
  ├─ set flow.status = IN_PROGRESS → emit SSE
  │
  └─ for each task:
       ├─ set task.status = IN_PROGRESS → emit SSE
       │
       └─ for each job:
            ├─ set job.status = IN_PROGRESS → emit SSE
            │
            ├─ nodeProcessorService.processJob(job, task, flow)
            │     └─ returns { status, statusDescription, outputEntityId, resultType }
            │
            ├─ [SUCCESS] set job.status = COMPLETED → emit SSE
            │
            └─ [FAILURE] set job.status = FAILED
                         set job.statusDescription = <error>
                         set task.status = FAILED
                         set task.statusDescription = <error>   ← bubbles up
                         set flow.status = FAILED
                         → emit SSE (final state with full error)
                         → return early
```

Every `emit SSE` call is `FlowEventsService.emit(flowId, flowExecutionState)`, which broadcasts the entire current state to all clients subscribed to that `flowId`.

---

## 4. Node Processors

Each processor implements `INodeProcessor`:

```typescript
interface INodeProcessor {
  processJob(
    job: IJobExecutionState,
    task: ITaskExecutionState,
    flow: ICreativeFlowBoard
  ): Promise<Partial<IExecutionResult>>;
}
```

Processors return an `IExecutionResult`. On error they return:
```typescript
{ status: StatusJob.FAILED, statusDescription: "human readable error" }
```

The `FlowRunnerService` then propagates `statusDescription` from the job up to the task level so the frontend can display it regardless of which node type the user opens the detail dialog on.

**Current processors:**

| Node Type | Processor | Error strategy |
|-----------|-----------|----------------|
| `AgentNodeComponent` | `CompletionNodeProcessor` | Returns FAILED with LLM error message |
| `VideoGenNodeComponent` | `VideoGenNodeProcessor` | Returns FAILED with AI service error + catches ECONNREFUSED |
| `AssetsNodeComponent` | `VideoGenNodeProcessor` | Same as above |
| `OutcomeNodeComponent` | `OutcomeNodeProcessor` | Returns FAILED with LLM error message |
| `NanoBananaNodeComponent` | `NanoBananaNodeProcessor` | Returns FAILED with Gemini error message |

---

## 5. SSE Subscription

### Endpoint: `GET /api/creative-flowboard/subscribe/:flowId`

Opens a persistent SSE stream. The `:flowId` is the **flow diagram id** (not the execution id).

**What is sent:** every time `FlowEventsService.emit(flowId, state)` is called, the full `IFlowExecutionState` is serialized and pushed as a standard SSE `data:` message.

**Example message payload:**
```json
{
  "flowId": "abc123",
  "flowExecutionId": "exec456",
  "status": "failed",
  "tasks": [
    {
      "processNodeId": "node-video-1",
      "status": "failed",
      "statusDescription": "connect ECONNREFUSED 192.168.2.3:3330",
      "jobs": [
        {
          "inputNodeId": "node-asset-1",
          "status": "failed",
          "statusDescription": "connect ECONNREFUSED 192.168.2.3:3330"
        }
      ]
    }
  ]
}
```

---

## 6. Error Propagation

Errors are designed to be fully visible in the frontend. The chain is:

```
AI service throws Error("connect ECONNREFUSED ...")
  → VideoGenNodeProcessor catches it
  → returns { status: FAILED, statusDescription: "connect ECONNREFUSED ..." }
  → FlowRunnerService sets job.statusDescription AND task.statusDescription
  → updateExecutionState() saves to MongoDB + emits SSE
  → Frontend receives full IFlowExecutionState
  → ExecutionDetailsComponent displays task.statusDescription
```

> **Key invariant**: whenever a job fails, the parent task's `statusDescription` is always set to the same message. This ensures the Execution Details dialog shows the error regardless of whether the user opens it from a process node (task view) or an input node (job view).

---

## 7. Frontend Integration

The frontend subscribes immediately after calling `POST /run-node`:

```typescript
// 1. Trigger execution
const result = await this.creativeFlowboardService.runNode(flowId, nodeId);

// 2. Subscribe to SSE stream
this.flowEventsService.subscribeToFlow(flowId).subscribe(event => {
  // event is IFlowExecutionState, Angular signals update the UI
});
```

The SSE service parses each message and calls `FlowExecutionStateService.setFlowExecutionState(state)`, which updates a signal. All node components reactively read their status from that signal via `taskExecutionState()` or `jobExecutionState()`.

---

## Related Documents

- [Node Execution Engine](node-execution-engine.md) — strategy pattern and processor dispatch
- [Execution State](execution-state.md) — lifecycle and persistence details
- [AI Services Communication](ai-services-comunication.md) — how processors call external AI
- [Angular SSE Connection](../technical-guides/angular-sse-connection.md) — frontend implementation
