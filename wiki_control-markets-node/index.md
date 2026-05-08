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
| [01_analysis_and_decisions/](01_analysis_and_decisions/index.md) | Architecture Decision Records — the "why" behind major choices |
| [02_plans/](02_plans/index.md) | Work-in-progress specs and unimplemented ideas |
| [03_references/](03_references/index.md) | Source-of-truth module docs, API contracts, schemas |
| [04_how-to/](04_how-to/index.md) | Step-by-step developer guides |
| [05_diagrams/](05_diagrams/index.md) | Excalidraw visual models |
| [06_business/](06_business/index.md) | Domain knowledge, user personas, product requirements |
| [99_more/](99_more/index.md) | Bruno API collections and miscellaneous content |

---

## Critical Files (Quick Access)

- [03_references/architecture.md](03_references/architecture.md) — Backend tech stack overview
- [03_references/flowboard/node-execution-engine.md](03_references/flowboard/node-execution-engine.md) — How `FlowRunner` orchestrates node execution
- [03_references/flowboard/execution-state.md](03_references/flowboard/execution-state.md) — Flow → Task → Job lifecycle
- [03_references/flowboard/real-time-sync.md](03_references/flowboard/real-time-sync.md) — SSE architecture details
- [04_how-to/creating-backend-node-logic.md](04_how-to/creating-backend-node-logic.md) — How to add a new node processor
- [06_business/understanding-control-markets.md](06_business/understanding-control-markets.md) — What the platform is and why it exists

---

## Backend Node Reference

> **Node Type Resolution:** Use `node.config.component` as the source of truth — not `node.type`.

| Node Type | Processor Class | Description |
| :--- | :--- | :--- |
| `AgentNodeComponent` | `CompletionNodeProcessor` | Persona-based AI agent that executes LLM tasks |
| `OutcomeNodeComponent` | `OutcomeNodeProcessor` | Final result processing and status update |
| `AssetsNodeComponent` | `VideoGenNodeProcessor` | Automation of video generation from uploaded input assets |
| `VideoGenNodeComponent` | `VideoGenNodeProcessor` | Orchestration of multi-resource video generation (Image + Audio) |
