# Control Markets Backend Documentation

Welcome to the backend documentation for **Control Markets**, a node-based platform for marketing automation. This documentation covers the architecture, execution engine, and real-time synchronization of the NestJS backend.

---

## 💡 Concepts
*Understand the high-level architecture and design principles.*

- **[Project Architecture](concepts/architecture.md)**: High-level overview of the backend tech stack (NestJS, Fastify, MongoDB).
- **[Node Execution Engine](concepts/node-execution-engine.md)**: How the `FlowRunner` orchestrates node execution using the Strategy pattern.
- **[Real-Time Synchronization](concepts/real-time-sync.md)**: Details on the SSE-based synchronization between frontend and backend.

---

## 🛠️ How-to Guides
*Practical, step-by-step instructions for common tasks.*

- **[Creating a New Node Processor](how-to/creating-backend-node-logic.md)**: The process for adding new execution logic for a custom node.

---

## 📚 Reference
*Technical facts, specifications, and API-level details.*

- **[Node Library Standard](reference/node-library-reference.md)**: The interface and requirements for node processors.

### Backend Node Reference Table
> [!NOTE]
> All nodes are processed using specialized `INodeProcessor` implementations. The `NodeProcessorService` acts as the dispatcher.

| Node Type | Processor Class | Description |
| :--- | :--- | :--- |
| `AgentNodeComponent` | `AgentNodeProcessor` | Persona-based AI agent that executes LLM tasks. |
| `OutcomeNodeComponent` | `OutcomeNodeProcessor` | Final result processing and status update. |
| `AssetsNodeComponent` | `VideoGenNodeProcessor` | Automation of video generation from input assets. |

---

## 🗺️ Plans & Roadmap
*Future implementation strategies.*

- **[Flow Scaling Plan](plans/flow-scaling-plan.md)**: (Placeholder for future plans)

---

## 📝 Contribution Guide
*How to add more documentation:*
1.  **Identify the type**: Concept, How-to, Reference, or Plan.
2.  **Add the file**: Place it in `docs/concepts/`, `docs/how-to/`, etc.
3.  **Update Index**: Link the file in `docs/index.md`.
4.  **Use Relative Links**: Always link using relative paths.
