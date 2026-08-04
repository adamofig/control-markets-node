# Chat UI context V1 — backend contract

`POST /api/chat/stream` accepts `ChatRequestV2`: user/assistant messages plus an optional structured `uiContext`. Client `system` messages and body `orgId` values are rejected by the strict schema.

## Security pipeline

1. `ProjectAuthGuard` authenticates Firebase or PAT credentials.
2. `InboxIdentityService.resolveActor()` resolves the persisted user, validates membership in the requested `X-Org-Id` and returns the canonical organization.
3. `UiContextSanitizerService` validates schema version/types, depth and size; redacts secret-like fields; applies a deterministic 12 KB budget; and recomputes the effective hash.
4. `UiCapabilityRegistryService` intersects enabled UI capabilities with the backend catalog.
5. `UiContextPromptComposerService` serializes the snapshot inside an explicitly untrusted JSON block.
6. `ChatService` exposes only tools compatible with the authorized capability set. Each tool uses the canonical organization; task assignees and flow mutations are checked against it.
7. The controller emits a `context` SSE event before text chunks so Angular can compare client/effective hashes.

UI context describes state but never grants permission. IDs, labels, selected records and capability names are all untrusted client data. The current registry is an allowlist, not a replacement for organization/ownership checks inside each tool.

## Response language

`ChatService` instructs the model to answer in the language of the user's most recent message, falling back to their last meaningful message when the language is ambiguous. The rule lives in the server-composed system prompt, so it applies consistently to standard and Agent Card-backed global chats without trusting a client-provided language field.

## SSE acknowledgement

```json
{
  "type": "context",
  "context": {
    "schemaVersion": 1,
    "contextHash": "ctx-…",
    "receivedContextHash": "ctx-…",
    "redactionCount": 0,
    "droppedFieldCount": 0,
    "bytes": 2048,
    "authorizedCapabilities": ["task.read"]
  }
}
```

## Current limitations

- Tasks is the first fully manifested frontend feature; other screens may send route-only generic context.
- The capability catalog is static and must later intersect organization roles/claims as those rules are standardized.
- Contextual update/delete tools for tasks do not exist yet; a visible `task.edit` capability only informs answers.
- Agent Card selection still needs a dedicated organization ownership check before custom cards are enabled for global chat.
- Context metadata is not yet persisted per conversation turn.

Key code lives in `src/chat/dto/chat-request.dto.ts`, `src/chat/context/**`, `src/chat/chat.controller.ts` and `src/chat/chat.service.ts`.
