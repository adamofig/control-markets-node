# Control Markets Backend Documentation

Welcome to the backend documentation for **Control Markets**, a node-based platform for automation highly specialized in decision-making with creative and tactical touches, helpful for marketing and content creation. This documentation covers the architecture, execution engine, and real-time synchronization of the NestJS backend (CreativeFlowboard).

## 🌍 Getting Started & Vision
*High-level overview of the project vision and core concepts.*

- **[Understanding Control Markets](business/understanding-control-markets.md)**: What is Control Markets and what are its key features.

---

## 📚 Technical Reference
*Architecture, core technologies, and fundamental concepts.*

- **[Project Architecture](technical-reference/architecture.md)**: High-level overview of the backend tech stack (NestJS, Fastify, MongoDB).
- [AI Services Communication](technical-reference/ai-services-comunication.md): How the backend requests and coordinates generative tasks with AI Services using Asset IDs.
- [Social Post Tracker](technical-reference/social-post-tracker.md): Schema and API reference for the content planning module — scheduling fields, MongoDB collection, and CRUD endpoints.
- [MCP Server](technical-reference/mcp-server.md): How the platform is exposed as an MCP server — available tools, endpoint URLs, and how to register it in Claude Code.
- [Organizations](technical-reference/organizations.md): Multi-tenant organization model, schema, and related API.
- [Human Resources](technical-reference/human-resources.md): HR collaborator tracking module — schema, payment config, API endpoints, and AI agent integration guide.

### Flowboard

- **[Node Execution Engine](technical-reference/flowboard/node-execution-engine.md)**: Deep dive into how the `FlowRunner` orchestrates node execution using the Strategy pattern.
- **[Node Library Standard](technical-reference/flowboard/node-library-reference.md)**: Technical specifications for node processors and their interfaces.
- **[Real-Time Synchronization](technical-reference/flowboard/real-time-sync.md)**: Technical details on the SSE-based synchronization between frontend and backend.
- [Execution State](technical-reference/flowboard/execution-state.md): Details on the lifecycle, persistence, and the **Flow -> Task -> Job** hierarchy.
- [Run-Node Communication Flow](technical-reference/flowboard/run-node-communication.md): Full lifecycle of a node execution — HTTP trigger, execution loop, error propagation, and SSE stream.
- [Nano Banana Integration](technical-reference/flowboard/nano-banana-integration.md): Integration details for the Nano Banana node and its execution flow.
- [Video Processor](technical-reference/flowboard/processors/video-processor.md): Technical overview of the multi-resource video generation engine.

### Backend Node Reference Table
> [!IMPORTANT]
> **Node Type Resolution**: The system uses `node.config.component` as the "Official Node Type" and source of truth for all business logic and processor selection. The root-level `node.type` property is often a generic wrapper (e.g., used by the UI framework) and should **not** be used for backend routing or execution state.

> [!NOTE]
> All nodes are processed using specialized `INodeProcessor` implementations. The `NodeProcessorService` acts as the dispatcher.

| Node Type | Processor Class | Description |
| :--- | :--- | :--- |
| `AgentNodeComponent` | `CompletionNodeProcessor` | Persona-based AI agent that executes LLM tasks. |
| `OutcomeNodeComponent` | `OutcomeNodeProcessor` | Final result processing and status update. |
| `AssetsNodeComponent` | `VideoGenNodeProcessor` | Automation of video generation from uploaded input assets. |
| `VideoGenNodeComponent` | `VideoGenNodeProcessor` | Orchestration of multi-resource video generation (Image + Audio). |

---

## 🛠️ Technical Guides
*Practical instructions and tutorials for developers and AI agents.*

- **[Creating a New Node Processor](technical-guides/creating-backend-node-logic.md)**: Step-by-step guide for developers to add new execution logic.
- **[Video Generation Guide](guides/video-generation.md)**: Detailed workflow for ComfyUI and Veo generation.
- **[Angular SSE Connection](technical-guides/angular-sse-connection.md)**: How to implement and debug the real-time connection on the frontend.

---

## 🚀 API Documentation
*Collection of API requests and examples.*

The project uses [Bruno](https://usebruno.com) for API testing and documentation. You can find the collections in the `docs/bruno-docs/` directory.

- **[Bruno Collections](bruno-docs/)**: Explore available API endpoints.

---

## 🗺️ Plans & Roadmap
*Future implementation strategies and architectural evolutions.*

- **[Astro Blog Publishing Plan](plans/astro_blog_publishing_plan.md)**: Strategy for automated content publishing.
- **[New Real-Time Architecture](plans/new_realtime_architecture.md)**: Proposed improvements to the synchronization layer.
- **[MCP Server Integration](plans/mcp-server-plan.md)**: Plan for exposing the platform as an MCP server so Claude Code and other AI agents can control it from the terminal.
- **[MCP Tools Expansion Plan](plans/mcp-tools-expansion-plan.md)**: Full plan for all resources and services that can be exposed as MCP tools — organized by module, priority, and implementation phase.

---

## 📝 Contribution Guide
*How to maintain and expand this documentation:*

1.  **Identify the type**: Technical Reference, Technical Guide, or Plan.
2.  **Add the file**: Place it in the corresponding directory (`docs/technical-reference/`, `docs/technical-guides/`, etc.).
3.  **Update Index**: Link the new file in `docs/index.md`.
4.  **Use Relative Links**: Always use relative paths for internal documentation links.
