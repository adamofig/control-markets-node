# Human Resources — Backend Reference

The Human Resources module tracks collaborators (employees, contractors, freelancers) so that AI agents can understand who is available, what they can do, and how they are compensated. Each record is linked to a platform `User` and carries an AI-readable description that agents can use to delegate tasks intelligently.

---

## Module Location

```
src/human-resources/
├── models/
│   └── human-resource.models.ts       ← IHumanResource interface + enums
├── schemas/
│   └── human-resource.schema.ts       ← Mongoose schema / entity class
├── services/
│   └── human-resource.service.ts      ← CRUD service (extends EntityCommunicationService)
├── controllers/
│   └── human-resource.controller.ts   ← REST endpoints (extends EntityController)
└── human-resources.module.ts
```

---

## Data Model

### Interface: `IHumanResource`

**File**: `src/human-resources/models/human-resource.models.ts`

```ts
export interface IHumanResource {
  _id?: string;
  id?: string;
  orgId?: string;
  userId: string;           // Required — references the platform User (_id from `users`)

  name?: string;            // Display name
  role?: string;            // Free-text role title, e.g. "Video Editor", "Developer"
  description?: string;     // AI-readable skills, working style, personality context
  status?: HRStatus;        // active | inactive | on-leave | terminated
  contractType?: HRContractType; // employee | contractor | freelancer | part-time
  skills?: string[];        // Tag array — AI capability index (e.g. ["video editing", "React"])

  payment?: IPaymentConfig; // Embedded payment configuration (see below)

  startDate?: Date;         // Contract start
  endDate?: Date;           // Contract end (optional for open-ended roles)

  auditable?: IAuditable;   // Created/updated by user metadata
  createdAt?: Date;
  updatedAt?: Date;
}
```

### Embedded: `IPaymentConfig`

```ts
export interface IPaymentConfig {
  type: PaymentType;            // 'recurring' | 'one-time'
  amount?: number;
  currency?: PaymentCurrency;   // 'USD' | 'EUR' | 'MXN'
  frequency?: PaymentFrequency; // 'weekly' | 'bi-weekly' | 'monthly' — only when recurring
  nextPaymentDate?: Date;
  notes?: string;
}
```

Payment configuration is stored as an **embedded object** inside the HR document — no separate collection is needed. This keeps the data model flat and queryable with a single read.

### Enums

| Enum | Values |
| :--- | :--- |
| `HRStatus` | `active`, `inactive`, `on-leave`, `terminated` |
| `HRContractType` | `employee`, `contractor`, `freelancer`, `part-time` |
| `PaymentType` | `recurring`, `one-time` |
| `PaymentFrequency` | `weekly`, `bi-weekly`, `monthly` |
| `PaymentCurrency` | `USD`, `EUR`, `MXN` |

### Mongoose Schema: `HumanResourceEntity`

**File**: `src/human-resources/schemas/human-resource.schema.ts`

- **Collection**: `human_resources`
- **Timestamps**: enabled (`createdAt`, `updatedAt` auto-managed)
- **Indexes**: `{ id: 1 }` unique, `{ orgId: 1 }`, `{ userId: 1 }`

| Field | Mongoose type | Default | Notes |
| :--- | :--- | :--- | :--- |
| `id` | String | — | Nanoid, set via `addIdAfterSave` hook |
| `orgId` | String | — | Multi-tenant scoping |
| `userId` | String | — | **Required** — platform User reference |
| `name` | String | — | |
| `role` | String | — | Free-text job title |
| `description` | String | — | AI context field |
| `status` | String (enum) | `active` | Workflow state |
| `contractType` | String (enum) | — | |
| `skills` | `[String]` | `[]` | AI capability tag array |
| `payment` | Object | — | Embedded `IPaymentConfig` |
| `startDate` | Date | — | |
| `endDate` | Date | — | |
| `auditable` | AuditDataSchema | `{}` | Created/updated by user metadata |

---

## API Endpoints

The controller inherits all CRUD operations from `@dataclouder/nest-mongo`'s `EntityController`. No custom endpoints are required.

| Method | Path | Action |
| :--- | :--- | :--- |
| `GET` | `/api/human-resources` | Return all HR records |
| `GET` | `/api/human-resources/:id` | Return a single record |
| `POST` | `/api/human-resources` | Create a new HR record |
| `PUT` | `/api/human-resources/:id` | Full update |
| `PATCH` | `/api/human-resources/:id` | Partial update |
| `DELETE` | `/api/human-resources/:id` | Delete a record |
| `POST` | `/api/human-resources/query` | Filtered query using `FiltersConfig` |

### Example: Create a contractor

```http
POST /api/human-resources
Content-Type: application/json

{
  "userId": "user_abc123",
  "orgId": "org_xyz789",
  "name": "Ana García",
  "role": "Video Editor",
  "description": "Senior video editor specializing in short-form TikTok content. Expert in CapCut and Premiere Pro. Fast turnaround, understands viral hooks and pacing for Latin American audiences.",
  "status": "active",
  "contractType": "freelancer",
  "skills": ["video editing", "CapCut", "Premiere Pro", "TikTok", "short-form"],
  "payment": {
    "type": "recurring",
    "amount": 1500,
    "currency": "USD",
    "frequency": "monthly",
    "nextPaymentDate": "2026-05-01T00:00:00.000Z"
  },
  "startDate": "2026-01-15T00:00:00.000Z"
}
```

### Example: Mark as on leave

```http
PATCH /api/human-resources/:id
Content-Type: application/json

{ "status": "on-leave" }
```

### Example: Query all active contractors in an org

```http
POST /api/human-resources/query
Content-Type: application/json

{
  "filters": {
    "orgId": "org_xyz789",
    "status": "active",
    "contractType": "contractor"
  },
  "rowsPerPage": 20
}
```

---

## Service

**File**: `src/human-resources/services/human-resource.service.ts`

`HumanResourceService` extends `EntityCommunicationService<HumanResourceDocument>` from `@dataclouder/nest-mongo`. Provides `findAll`, `findOne`, `save` (upsert), `update`, `partialUpdate`, `delete`, and `queryUsingFiltersConfig` out of the box. No custom business logic is required at this stage.

---

## AI Agent Integration

The `description` field and `skills` array are the primary fields AI agents consume when making delegation decisions. When an agent needs to assign a task (e.g., "edit this video"), it should:

1. Query `POST /api/human-resources/query` with `{ "status": "active", "orgId": "<current-org>" }`.
2. Read each `description` and `skills` array to match capabilities to the task requirements.
3. Select the best-fit collaborator and reference their `userId` when creating or assigning work.

Keep `description` detailed and written in natural language — it is the main AI context surface for this entity.

---

## Extending in the Future

- **Performance reviews**: Add an embedded `reviews: IReview[]` array to track periodic feedback without a new collection.
- **Time tracking**: Link to a `time_entries` collection keyed by `hrId` if granular work logging is needed.
- **Automated payment reminders**: A scheduled NestJS `CronJob` can query `{ "payment.nextPaymentDate": { $lte: new Date() }, "status": "active" }` and emit a notification or SSE event.
- **Flowboard integration**: Add an `HRNodeProcessor` so flows can query available HR capacity as part of a content production pipeline.
