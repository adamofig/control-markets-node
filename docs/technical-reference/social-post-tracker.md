# Social Post Tracker — Backend Reference

The Social Post Tracker module stores content-planning records for social media posts. It is a **planner / tracker** — it persists post metadata (video URL, platform, scheduled date, status) but does not auto-publish to social networks.

---

## Module Location

```
src/social-media-tracker/
├── models/
│   └── social-media-tracker.models.ts   ← ISocialMediaTracker interface
├── schemas/
│   └── social-media-tracker.schema.ts   ← Mongoose schema / entity class
├── services/
│   └── social-media-tracker.service.ts  ← CRUD service (extends EntityCommunicationService)
├── controllers/
│   └── social-media-tracker.controller.ts ← REST endpoints (extends EntityController)
└── social-media-tracker.module.ts
```

---

## Data Model

### Interface: `ISocialMediaTracker`

**File**: `src/social-media-tracker/models/social-media-tracker.models.ts`

```ts
export interface ISocialMediaTracker {
  _id?: string;
  id?: string;
  name?: string;         // Human-readable post title
  description?: string;
  asset?: any;           // Legacy storage-asset reference (kept for backward compat)
  auditable?: IAuditable;

  // Scheduling fields
  scheduledDate?: Date | string;  // ISO date/time the post is intended to go live
  platform?: string;              // 'tiktok' | 'instagram' | 'youtube'
  status?: string;                // 'draft' | 'scheduled' | 'published'
  notes?: string;                 // Caption, hashtags, or internal notes
  videoUrl?: string;              // Public cloud storage URL of the video file
}
```

### Mongoose Schema: `SocialMediaTrackerEntity`

**File**: `src/social-media-tracker/schemas/social-media-tracker.schema.ts`

- **Collection**: `socialMediaTracker`
- **Timestamps**: enabled (`createdAt`, `updatedAt` auto-managed)
- **Index**: `{ id: 1 }` unique

| Field | Mongoose type | Default | Notes |
| :--- | :--- | :--- | :--- |
| `id` | String | — | Nanoid, set via `addIdAfterSave` hook |
| `name` | String | — | |
| `description` | String | — | |
| `asset` | Object | — | Legacy video-asset reference |
| `scheduledDate` | Date | — | Used by the frontend calendar to place the post on the correct day |
| `platform` | String | — | One of `tiktok`, `instagram`, `youtube` |
| `status` | String | `'draft'` | Workflow state |
| `notes` | String | — | Free-text caption or hashtags |
| `videoUrl` | String | — | Direct public URL returned by the cloud storage upload |
| `auditable` | AuditDataSchema | `{}` | Created/updated by user metadata |

---

## API Endpoints

The controller inherits all CRUD operations from `@dataclouder/nest-mongo`'s `EntityController`. No custom endpoints are needed.

| Method | Path | Action |
| :--- | :--- | :--- |
| `GET` | `/api/social-media-tracker` | Return all post records |
| `GET` | `/api/social-media-tracker/:id` | Return a single record |
| `POST` | `/api/social-media-tracker` | Create a new post record |
| `PUT` | `/api/social-media-tracker/:id` | Full update of an existing record |
| `PATCH` | `/api/social-media-tracker/:id` | Partial update |
| `DELETE` | `/api/social-media-tracker/:id` | Delete a record |

### Example: Create a scheduled post

```http
POST /api/social-media-tracker
Content-Type: application/json

{
  "name": "Campaign launch — March",
  "platform": "tiktok",
  "status": "scheduled",
  "scheduledDate": "2026-03-25T18:00:00.000Z",
  "videoUrl": "https://storage.googleapis.com/bucket/orgs/abc/social-posts/video.mp4",
  "notes": "#launch #newproduct"
}
```

### Example: Mark a post as published

```http
PATCH /api/social-media-tracker/:id
Content-Type: application/json

{ "status": "published" }
```

---

## Service

**File**: `src/social-media-tracker/services/social-media-tracker.service.ts`

`SocialMediaTrackerService` extends `EntityCommunicationService<ISocialMediaTracker>` from `@dataclouder/nest-mongo`. This provides `findAll`, `findOne`, `createOrUpdate`, and `remove` out of the box. No custom business logic is required at this stage.

---

## Extending in the Future

When auto-posting to social platforms is needed, the recommended approach is:

1. Install a job queue (e.g., `@nestjs/bull` + `bullmq`).
2. Add a scheduled job that queries `{ status: 'scheduled', scheduledDate: { $lte: new Date() } }`.
3. Call the relevant platform SDK (TikTok API, Instagram Graph API, YouTube Data API).
4. Update `status` to `'published'` on success, or add a `lastError` field on failure.
5. Wire in a `DistributionChannelNodeProcessor` inside the Creative Flowboard execution engine so that distribution can also be triggered from a flow.
