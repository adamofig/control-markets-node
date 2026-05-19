# Agentic Loop — Chat Service

## What is it?

The chat module implements a **single-agent ReAct loop** (Reason → Act → Observe → repeat). The model autonomously decides which tools to call and in what order to resolve a user query, without manual orchestration code.

Implementation: `src/chat/chat.service.ts` using `streamText` from the **Vercel AI SDK v6** with the `@ai-sdk/google` provider (Gemini).

---

## How the loop works

```
User message arrives
       │
       ▼
  streamText() starts
       │
       ▼
  Model reasons about the query
       │
       ├─ Needs data? → calls a tool
       │                    │
       │              SDK executes it (auto)
       │                    │
       │              result fed back to model
       │                    │
       │              model reasons again  ◄─── repeat (up to 5 steps)
       │
       └─ Has enough info? → streams final text response to client
```

- `stopWhen: stepCountIs(5)` caps the loop at 5 agentic steps per request.
- Streaming is token-by-token via `result.textStream` (`AsyncIterable<string>`).
- The system prompt is built from the Firebase JWT token on every request — no DB call needed for basic user context (userId, email, name, plan).

---

## Available tools

| Tool | Description | Key inputs |
|---|---|---|
| `moveNodes` | Move one or more nodes on a flowboard canvas to new (x, y) positions | `flowId`, `positions[]` → `{ nodeId, x, y }` |

> **To add a new tool:** define it inside the `tools` object in `streamText()` using `tool({ description, inputSchema, execute })`. The model will discover and use it automatically based on its description.

---

## Comparison with heavier frameworks

| | This implementation | PydanticAI / LangGraph / CrewAI |
|---|---|---|
| Abstraction | Low — manual tool wiring, SDK runs loop | High — Agents, Graphs, Crews as first-class objects |
| Multi-agent | Not built-in | Native (handoffs, supervisor patterns) |
| Goal decomposition | No — single query scope | Yes — plan → sub-tasks → sub-agents |
| Streaming | First-class | Varies |
| Complexity | Simple, low overhead | Complex pipelines and DAGs |

Use this pattern when one model + a few tools can resolve queries in a handful of steps. Reach for a proper orchestration framework when you need multi-agent coordination, retries with different strategies, or cross-request planning.

---

## Adding tools checklist

1. Add the tool inside the `tools` object in `streamText()` in `chat.service.ts`.
2. Use `z.object(...)` for the `inputSchema` — Zod shapes are enforced at runtime.
3. Write a clear `description` — the model reads this to decide when to call the tool.
4. Inject the relevant NestJS service in `ChatService` constructor and call it from `execute`.
5. Return a plain serializable object from `execute` (no class instances).
