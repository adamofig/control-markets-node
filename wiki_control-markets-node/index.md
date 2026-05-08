# Control Markets Node — Wiki

**Control Markets** is a distributed platform for automating marketing, content creation, and persona-based AI agent workflows. This wiki documents the primary NestJS backend (`control-markets-node`), which handles orchestration, API routing, MongoDB persistence, and real-time SSE streaming.

---

## Project Rules & Guidelines

- **Framework:** NestJS v11+ on Fastify. MongoDB via Mongoose.
- **Node type resolution:** Always use `node.config.component` as the canonical node type — never `node.type`.
- **Strategy pattern for nodes:** Every canvas node maps to an `INodeProcessor`. Never put node logic directly in the runner.
- **Entity scaffold:** All new entities follow the module/service/controller/schema scaffold. Use the `/entity-scaffold` skill.
- **Real-time:** SSE only — no polling. One subscription per flow at `GET /api/creative-flowboard/subscribe/:flowId`.
- **Multi-tenancy:** Every document is scoped to an `organization`. Always include org context.
- **Execution hierarchy:** Flow → Task → Job. Model new features at the correct level.

---

## Navigation Map

| Folder | Purpose |
| :--- | :--- |
| [01_business/](01_business/index.md) | Domain knowledge, user personas, product requirements |
| [02_references/](02_references/index.md) | Source-of-truth module docs, API contracts, schemas |
| [03_how-to/](03_how-to/index.md) | Step-by-step developer guides |
| [04_analysis_and_decisions/](04_analysis_and_decisions/index.md) | Architecture Decision Records — the "why" behind major choices |
| [05_plans/](05_plans/index.md) | Work-in-progress specs and unimplemented ideas |
| [06_diagrams/](06_diagrams/index.md) | Excalidraw visual models |
| [99_more/](99_more/index.md) | Bruno API collections and miscellaneous content |

---

## Critical Files (Quick Access)

- [02_references/architecture.md](02_references/architecture.md) — Backend tech stack overview
- [02_references/flowboard/node-execution-engine.md](02_references/flowboard/node-execution-engine.md) — How `FlowRunner` orchestrates node execution
- [02_references/flowboard/execution-state.md](02_references/flowboard/execution-state.md) — Flow → Task → Job lifecycle
- [02_references/flowboard/real-time-sync.md](02_references/flowboard/real-time-sync.md) — SSE architecture details
- [03_how-to/creating-backend-node-logic.md](03_how-to/creating-backend-node-logic.md) — How to add a new node processor
- [01_business/understanding-control-markets.md](01_business/understanding-control-markets.md) — What the platform is and why it exists

---

## Backend Node Reference

> **Node Type Resolution:** Use `node.config.component` as the source of truth — not `node.type`.

| Node Type | Processor Class | Description |
| :--- | :--- | :--- |
| `AgentNodeComponent` | `CompletionNodeProcessor` | Persona-based AI agent that executes LLM tasks |
| `OutcomeNodeComponent` | `OutcomeNodeProcessor` | Final result processing and status update |
| `AssetsNodeComponent` | `VideoGenNodeProcessor` | Automation of video generation from uploaded input assets |
| `VideoGenNodeComponent` | `VideoGenNodeProcessor` | Orchestration of multi-resource video generation (Image + Audio) |
