# Recent Resources — Backend Guide

## What It Does

The Recent Resources feature tracks which platform resources (Flows, Tasks, Agent Cards, Social Posts) a user has recently opened or edited. On each interaction, a record is upserted into a dedicated MongoDB collection. The frontend calls this service on login to pre-populate the home page dashboard.

---

## Module Location

```
src/recent-resources/
├── models/
│   └── recent-resources.models.ts    # Enum, interfaces, DTO
├── schemas/
│   └── recent-resource.schema.ts     # Mongoose schema + indexes
├── services/
│   └── recent-resources.service.ts   # Upsert + trim + fetch logic
├── controllers/
│   └── recent-resources.controller.ts
└── recent-resources.module.ts
```

---

## MongoDB Collection: `recent_resources`

| Field | Type | Description |
|---|---|---|
| `userId` | `string` | Resolved user ID from the `users` collection |
| `resourceId` | `string` | The ID of the tracked resource |
| `collection` | `enum` | Which collection the resource belongs to |
| `name` | `string` | Display name cached at track time |
| `accessedAt` | `Date` | Timestamp updated on every access |
| `createdAt` / `updatedAt` | `Date` | Auto-managed by `timestamps: true` |

**Indexes:**
- `{ userId: 1, accessedAt: -1 }` — powers the GET query (sort by recency per user)
- `{ userId: 1, resourceId: 1 }` unique — enforces one record per resource per user, enabling safe upserts

---

## Enum: `RecentResourceCollection`

```typescript
export enum RecentResourceCollection {
  AGENT_FLOWS = 'agent_flows',
  AGENT_TASKS = 'agent_tasks',
  AGENT_CARDS = 'agent_cards',
  SOCIAL_MEDIA_TRACKER = 'social_media_tracker',
}
```

Values match the actual MongoDB collection names used across the platform.

---

## API Endpoints

### `POST /api/recent-resources`

Tracks (upserts) a resource access for the authenticated user.

**Auth:** Firebase JWT required (`AppGuard` + `AuthGuard`)

**Request body:**
```json
{
  "resourceId": "abc123",
  "collection": "agent_flows",
  "name": "My Campaign Flow"
}
```

**Behavior:**
1. Resolves the user via `userService.findUserByEmail(token.email)`
2. Upserts into `recent_resources` using `{ userId, resourceId }` as the match key
3. On match: updates `name`, `collection`, and `accessedAt`
4. On insert: writes all fields
5. After upsert: fetches all records for the user sorted by `accessedAt DESC`, deletes any beyond the 20th

**Response:** the upserted document

---

### `GET /api/recent-resources?limit=5`

Returns the authenticated user's most recently accessed resources.

**Auth:** Firebase JWT required

**Query params:**
- `limit` (optional, default `5`) — max number of records to return

**Response:**
```json
[
  {
    "id": "...",
    "userId": "user123",
    "resourceId": "abc123",
    "collection": "agent_flows",
    "name": "My Campaign Flow",
    "accessedAt": "2026-03-27T10:00:00.000Z"
  }
]
```

---

## Service Logic: `RecentResourcesService`

Extends `EntityCommunicationService<RecentResourceDocument>` following the standard platform pattern.

### `trackResource(userId, dto)`

```typescript
// 1. Upsert
findOneAndUpdate(
  { userId, resourceId },
  {
    $set: { collection, name, accessedAt: new Date() },
    $setOnInsert: { userId, resourceId },
  },
  { upsert: true, new: true }
)

// 2. Trim to MAX_RECENTS (20)
// Fetches all IDs sorted by accessedAt DESC, deletes any beyond index 20
```

**Why `$setOnInsert`?** Prevents `userId` and `resourceId` from being overwritten on updates — only written on the initial insert.

### `getRecentForUser(userId, limit)`

Simple query: `.find({ userId }).sort({ accessedAt: -1 }).limit(limit).lean()`

---

## Controller Pattern

Does **not** extend `EntityController` — both endpoints are fully custom. Follows the `InitController` pattern: plain `@Controller` with `@UseGuards(AppGuard, AuthGuard)` and `@DecodedToken()` to extract the Firebase token.

User resolution is always done via `userService.findUserByEmail(token.email)` to get the stable `user.id` used in the collection.

---

## Adding a New Trackable Resource Type

1. Add a new value to `RecentResourceCollection` in `models/recent-resources.models.ts`
2. Add the matching value to the Angular enum in `control-markets-angular/src/app/services/recent-resources.service.ts`
3. Add a route mapping and icon in the Angular `COLLECTION_ROUTE_MAP` and `COLLECTION_ICON_MAP`
4. Inject `RecentResourcesService` in the Angular component and call `trackResource()` at the right interaction point

---

## Limits & Design Decisions

| Decision | Value / Reason |
|---|---|
| Max records per user | 20 — keeps the collection lean; old records purged after each upsert |
| Home page display limit | 5 — passed via `?limit=5` from the Angular service |
| Scope | Per-user (not per-org) — recents are personal, not collaborative |
| Deduplication | Unique compound index `(userId, resourceId)` — same resource opened multiple times updates `accessedAt`, never duplicates |
| Tracking failure | Non-critical — the Angular service catches and silently ignores errors so UX is never blocked |
