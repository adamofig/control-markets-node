# Chat Module

Streaming agentic chat powered by Google Gemini via the Vercel AI SDK. Exposes a single authenticated SSE endpoint consumed by the Angular frontend for real-time token-by-token responses. The model has access to tools that query the database, making it aware of who the user is and able to answer personalized questions.

---

## Files

| File | Purpose |
|---|---|
| `chat.module.ts` | NestJS module — wires controller, service, and imports `NestAuthModule` + `UserModule` |
| `chat.controller.ts` | HTTP controller — handles `POST /api/chat/stream`, protected by Firebase `AuthGuard` |
| `chat.service.ts` | Business logic — builds system prompt from JWT token, calls Gemini with agentic tools |

---

## Authentication

The endpoint is protected by Firebase JWT authentication:

```typescript
@UseGuards(AppGuard, AuthGuard)
@Controller('api/chat')
export class ChatController { ... }
```

The Angular frontend must send a valid Firebase ID token as a Bearer token:

```
Authorization: Bearer <firebase-id-token>
```

The `@DecodedToken()` decorator extracts the decoded token from the request and passes it to the service. Basic user info (userId, email, display name, plan) is injected into the system prompt automatically on every request — no DB call needed for simple questions like "what's my name?".

---

## Agentic Tools

The model can call tools to fetch live data from MongoDB when it needs more detail:

| Tool | What it fetches |
|---|---|
| `getUserProfile` | Full user document — personal data, email, auth strategy |
| `getUserStats` | Points, redeemable points, learning stats |
| `getUserSettings` | Language preferences (base/target lang, audio speed, words per session) |
| `getUserWords` | Words the user has saved for a given language code |
| `getScore` | Random score 1–10 (demo tool) |

`stopWhen: stepCountIs(5)` allows up to 5 agentic steps per request (tool call → result → model response → repeat).

---

## How streaming works

### 1. Frontend sends a POST request

The Angular service (`chat-stream.service.ts`) sends a standard `POST /api/chat/stream` with the full message history:

```json
{
  "messages": [
    { "role": "user", "content": "Hello!" },
    { "role": "assistant", "content": "Hi! How can I help?" },
    { "role": "user", "content": "What are my points?" }
  ]
}
```

> **Why POST and not EventSource?** `EventSource` only supports GET requests. Since the chat history is sent in the body, `fetch` with a `ReadableStream` reader is used instead.

### 2. Backend builds context and streams via SSE

`ChatController` sets SSE headers and iterates the `AsyncIterable<string>` returned by `ChatService`. Before streaming, the service builds a system prompt with the user's identity from the JWT token and starts the Gemini stream with the available tools.

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

Each token chunk is written as:
```
data: {"text":"Hello"}\n\n
data: {"text":", how"}\n\n
data: {"text":" are you?"}\n\n
data: [DONE]\n\n
```

### 3. AI SDK manages the agentic loop

`ChatService` uses `streamText` from `ai` (Vercel AI SDK v6) with the `@ai-sdk/google` provider. When the model calls a tool, the SDK automatically executes it and feeds the result back to the model for the next step (up to `stepCountIs(5)`):

```typescript
const result = streamText({
  model: this.google('gemini-2.0-flash'),
  system,           // built from JWT token
  messages,
  stopWhen: stepCountIs(5),
  tools: { getUserProfile, getUserStats, getUserSettings, getUserWords, getScore },
});
return result.textStream; // AsyncIterable<string>
```

### 4. Frontend reads and renders chunks

`ChatStreamService` (Angular) reads the response body as a `ReadableStream`, parses each SSE line, and yields text chunks via an `AsyncGenerator<string>`.

The component iterates with `for await` and appends each chunk to a signal (`streamingText`), producing the live typing effect:

```typescript
for await (const chunk of this.chatStreamService.streamChat(messages)) {
  this.streamingText.update(prev => prev + chunk);
}
```

---

## Data flow

```
Angular Component
  │  for await (chunk of streamChat(messages))
  ▼
ChatStreamService (fetch + ReadableStream)
  │  POST /api/chat/stream  [Authorization: Bearer <token>]
  ▼
ChatController (NestJS / Fastify)
  │  AuthGuard validates Firebase token → @DecodedToken() extracts user
  │  res.raw.write(`data: ${JSON.stringify({ text: chunk })}\n\n`)
  ▼
ChatService
  │  buildSystemPrompt(token) → injects userId, email, name, plan
  │  streamText({ model, system, messages, tools, stopWhen })
  │
  │  [if model calls a tool]
  │  ├─ getUserProfile / getUserStats / getUserSettings → AppUserService → MongoDB
  │  └─ result fed back to model for next step
  ▼
@ai-sdk/google → Gemini Flash (Google AI)
```

---

## Configuration

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Google AI API key — set in `.env` |

The model is configured in `chat.service.ts`. To change the model, update the string passed to `this.google(...)`.

---

## Frontend entry point

- **Route**: `/app/ai-chat`
- **Menu**: Tester → AI Chat
- **Component**: `polilan-angular/src/app/pages/ai-chat/`
- **Service**: `polilan-angular/src/app/core/data-services/chat-stream.service.ts`
