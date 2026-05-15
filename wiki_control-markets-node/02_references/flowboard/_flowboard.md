# 03 — References / Flowboard

Technical reference for the node-based execution engine, real-time sync, and all flow-related subsystems.

## Files

- [node-execution-engine.md](node-execution-engine.md) — Deep dive into how `FlowRunner` orchestrates node execution using the Strategy pattern.
- [node-library-reference.md](node-library-reference.md) — Technical specifications for node processors and their interfaces.
- [real-time-sync.md](real-time-sync.md) — Technical details on the SSE-based synchronization between frontend and backend.
- [execution-state.md](execution-state.md) — Lifecycle, persistence, and the Flow → Task → Job hierarchy.
- [run-node-communication.md](run-node-communication.md) — Full lifecycle of a node execution — HTTP trigger, execution loop, error propagation, and SSE stream.
- [nano-banana-integration.md](nano-banana-integration.md) — Integration details for the Nano Banana node and its execution flow.

## Sub-folders

- [processors/](processors/index.md) — Individual processor references.
