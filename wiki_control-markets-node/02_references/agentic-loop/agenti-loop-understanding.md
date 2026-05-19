# Agentic Loop — Implementation Notes

## What was built

The chat module uses a **single-agent ReAct loop** via `streamText` from the Vercel AI SDK. The model autonomously decides which tools to call and in what order, without manual orchestration.

The key addition was wiring two new tools that allow the model to take real database actions:

| Tool | What it does |
|---|---|
| `getOrganizationUsers` | Searches MongoDB users by name/email scoped to an `orgId` |
| `createTask` | Creates an `AgentTask` document and assigns it to a resolved user |

With these tools, a message like *"crea una tarea asignada a Ulises"* triggers the following autonomous chain:
1. Model calls `getOrganizationUsers({ orgId, search: "Ulises" })` → gets `userId`
2. Model calls `createTask({ orgId, name: "...", assignedUserId: "..." })` → creates the record
3. Model responds confirming the action — no clarifying questions needed

---

## How orgId reaches the backend

The `orgId` is not available in the Firebase JWT (`AppToken`), so it is passed explicitly:

```
Frontend (ChatAssistantService)
  → reads orgId from currentOrganization() signal
  → sends { messages, orgId } in the POST body to /api/chat/stream

Backend (ChatController)
  → receives orgId from body
  → passes it to ChatService.streamChat(messages, token, orgId)
  → ChatService injects it into buildSystemPrompt() and tools have it available
```

The model reads the `orgId` from the system prompt and uses it as an argument when calling `getOrganizationUsers` and `createTask`.

---

## The two system prompts — current state and future plan

Right now there are **two separate system prompts** that never merge:

### 1. Frontend system prompt (`ChatAssistantService.buildSystemPrompt`)
Built in Angular and sent as `messages[0]` with `role: 'system'`. Contains rich page context:
- Current page, entity type, mode (list / edit / create)
- Active entity data (form values, selected item)
- Organization name and orgId
- User's name, email, gender

### 2. Backend system prompt (`ChatService.buildSystemPrompt`)
Built in NestJS from the JWT token and the `orgId` from the request body. Contains:
- User ID, email, display name, plan
- Organization ID
- Tool inventory and instructions on how to use them autonomously

**The backend `system` param in `streamText` is what the model actually uses** — the frontend system message arrives in the `messages` array but the Vercel AI SDK / Gemini provider treats the `system` parameter as the authoritative system instruction. The frontend message with `role: 'system'` is currently effectively ignored by the model.

### Future: merge both into one

The backend system prompt should absorb the page context that the frontend builds. Two options:

**Option A — Backend reads the frontend system message from the messages array**
Filter out the first message if `role === 'system'`, extract its content, and append it to `buildSystemPrompt()`. No frontend changes needed.

```typescript
const frontendSystemMsg = messages.find(m => m.role === 'system');
const filteredMessages = messages.filter(m => m.role !== 'system');
const system = this.buildSystemPrompt(token, orgId) + (frontendSystemMsg ? '\n\n' + frontendSystemMsg.content : '');
```

**Option B — Pass context as a structured field in the request body**
Add a `context` object to the POST body (page, entity, mode, data) and build the full prompt server-side. More explicit but requires keeping frontend and backend DTO in sync.

Option A is simpler and non-breaking.
