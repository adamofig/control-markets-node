# MCP Implementation — What Is Exposed

All tools are registered in `src/mcp/mcp.module.ts` via `McpModule.forFeature([...], 'control-markets')` and run inside the same NestJS/Fastify instance on port `8121`.

---

## Tool files

| File | Prefix | Service |
| :--- | :----- | :------ |
| `mcp-flowboard.tools.ts` | `flow_` | `CreativeFlowboardService` |
| `mcp-tasks.tools.ts` | `tasks_` | `AgentTasksService`, `AgentOutcomeJobService` |
| `mcp-social.tools.ts` | `social_` | `SocialMediaTrackerService` |
| `mcp-organization.tools.ts` | `org_` | `OrganizationService` |
| `mcp-user.tools.ts` | `users_` | `AppUserService` |

---

## `flow_` — Flowboard tools

| Tool | Description |
| :--- | :---------- |
| `flow_listFlows` | List all flowboards (id, name, node count) |
| `flow_getFlow` | Full flowboard definition including nodes and edges |
| `flow_runNode` | Execute a single node (async, returns initial `IFlowExecutionState`) |
| `flow_runAndWait` | Execute a single node and block until done (returns `AgentOutcomeJob`) |
| `flow_runFlow` | Execute all nodes in a flowboard in sequence |
| `flow_moveNodes` | Move one or more nodes to new (x, y) canvas positions |
| `flow_addNodes` | Append nodes and edges to an existing flowboard |

---

## `tasks_` — Agent tasks and outcome jobs

| Tool | Description |
| :--- | :---------- |
| `tasks_getSchema` | Return JSON Schema for `agent_tasks` and `agent_outcome_jobs` — call this first when unsure of field names |
| `tasks_operation` | Full MongoDB operation on `agent_tasks` (find, create, update, delete, aggregate) |
| `tasks_getByAssignee` | Find tasks by `assignedTo.userId`, `.email`, or `.name`; optionally filter by status |
| `tasks_executeTask` | Execute an agent task by ID (requires a linked agent card) |
| `tasks_jobsOperation` | Full MongoDB operation on `agent_outcome_jobs` |

Key `agent_tasks` fields: `name`, `description`, `status` (`pending`/`in_progress`/`done`/`paused`/`""`/`null`), `taskType` (`review_task`/`create_content`/`human_task`), `assignedType` (`agent`/`user`), `assignedTo { userId, email, name }`, `orgId`.

---

## `social_` — Social media tracker

| Tool | Description |
| :--- | :---------- |
| `social_operation` | Full MongoDB operation on `social_media_tracker` |
| `social_listPosts` | List posts; optional filters: `platform`, `status` |
| `social_getPostsThisWeek` | Posts scheduled for the current Monday–Sunday window |
| `social_getPost` | Single post by ID |
| `social_createPost` | Create a new post entry |
| `social_updatePost` | Patch fields of an existing post |

Platforms: `tiktok` | `instagram` | `youtube`. Statuses: `draft` | `scheduled` | `published`.

---

## `org_` — Organizations

| Tool | Description |
| :--- | :---------- |
| `org_operation` | Full MongoDB operation on `organizations` |
| `org_getMembers` | Return all guests of an org by `orgId` |
| `org_findByUser` | Find all orgs a user belongs to by email |
| `org_operateUser` | Add or remove a user from an org (handles both `organizations` and `guests` arrays atomically) |

Key fields: `name`, `type` (`personal` or custom), `guests [{ userId, email }]`, `socialNetworks [{ type, account }]`.

---

## `users_` — Users

| Tool | Description |
| :--- | :---------- |
| `users_operation` | Full MongoDB operation on `users` |
| `users_findByEmail` | Look up a user by email (returns full document) |
| `users_findById` | Look up a user by internal `id` field |
| `users_updateByEmail` | Patch user fields by email (uses `$set`; do NOT use for org membership — use `org_operateUser`) |

Key fields: `email`, `fbId`, `defaultOrgId`, `organizations [{ orgId, name, roles[] }]`, `personalData { firstname, lastname, nickname }`, `settings`, `claims { plan, permissions, roles }`.

---

## Operation pattern (shared across collections)

Four of the five tool files expose a generic `*_operation` tool that accepts:

```typescript
{
  action: 'find' | 'findOne' | 'create' | 'updateOne' | 'updateMany' | 'deleteOne' | 'aggregate' | 'clone'
  query?:      Record<string, unknown>   // MongoDB filter
  payload?:    unknown                   // document body or aggregate pipeline
  projection?: Record<string, unknown>   // fields to include/exclude
  options?:    Record<string, unknown>   // sort, limit, skip, etc.
}
```

Use dot-notation for nested fields: `"assignedTo.email"`, `"guests.userId"`, `"personalData.firstname"`.
