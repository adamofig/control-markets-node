# Backend Project Architecture

Control Markets Backend is built with transparency and scalability in mind, using a modular architecture that separates orchestration from execution logic.

## Tech Stack

The backend is a **NestJS** application running on **Fastify** for high-performance HTTP handling.

- **Framework**: [NestJS](https://nestjs.com/)
- **HTTP Layer**: Fastify
- **Database**: 
  - **MongoDB** (via Mongoose): Persistent storage for flows, nodes, and results.
  - **Firestore**: Real-time storage for execution status and job tracking.
- **AI Integrations**:
  - OpenAI (GPT-4)
  - Google Vertex AI
  - Groq & Ollama
- **Storage**: Minio (Object storage for assets)
- **Scraping/Automation**: Playwright

## System Layers

### 1. API Layer (`CreativeFlowboardController`)
Handles HTTP requests for managing flows (CRUD) and initiating executions. It also provides an SSE endpoint for real-time canvas synchronization.

### 2. Orchestration Layer (`CreativeFlowboardService`)
Coordinates the high-level workflow. It doesn't know *how* nodes execute, but it knows *when* to start them. It interacts with the `FlowStateService` to initialize a run's state.

### 3. Execution Layer (`FlowRunnerService`)
The core engine that iterates through tasks and jobs. It manages the lifecycle of a flow execution, updating statuses in both MongoDB and Firestore.

### 4. Processing Layer (`NodeProcessorService`)
Implements the **Strategy Design Pattern**. It dispatches specific execution logic to specialized "Node Processors" based on the node type.

### 5. AI & Data Layer
Includes specialized services for building prompts (`PromptBuilderService`), interacting with LLMs (`LLMAdapterService`), and managing specific entities like Agents, Leads, and Video Projects.

## Node Library Philosophy

The backend is designed as a "Node Library." This means that the core engine is agnostic to the logic of individual nodes. To add functionality, you simply add a new processor strategy, making the system highly extensible without modifying the core orchestrator.
