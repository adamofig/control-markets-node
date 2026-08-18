import { z } from 'zod';

// ─── Primitives ──────────────────────────────────────────────────────────────

export const cloudStorageDataSchema = z.object({
  bucket: z.string().optional(),
  url: z.string().optional(),
  path: z.string().optional(),
});

export const messageAISchema = z.object({
  role: z.string().describe('"user" | "assistant" | "system"'),
  content: z.string(),
});

export const sourceTaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().describe('"document" | "website" | "youtube" | "notion" | "tiktok"'),
});

// ─── AssignedTo ───────────────────────────────────────────────────────────────

export const assignedUserSchema = z.object({
  userId: z.string().describe('Firebase UID'),
  email: z.string().describe('User email'),
  name: z.string().describe('Display name'),
});

/** Minimal shape when assignedType === "agent". Full IAgentCard not Zod-ified (external pkg). */
export const agentCardMinimalSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string().optional(),
  assets: z.unknown().optional(),
});

/**
 * The agentic profile that owns the task — canonical for `assignedType === "agent"`.
 * Query with "agenticProfileId" (flat, indexed) or "agenticProfile.id".
 */
export const agenticProfileMinimalSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  title: z.string().optional(),
  agentCardId: z.string().optional().describe("The profile's linked agent card"),
  imageUrl: z.string().optional(),
});

/**
 * assignedTo is a union — check assignedType to know which branch:
 *   assignedType === "user"  → assignedUserSchema  { userId, email, name }
 *   assignedType === "agent" → agentCardMinimalSchema  { id, name, title }
 *
 * Query examples:
 *   { "assignedTo.name": "Adamo" }
 *   { "assignedTo.email": "user@example.com" }
 *   { "assignedTo.userId": "<uid>" }
 */
export const assignedToSchema = z.union([assignedUserSchema, agentCardMinimalSchema]);

// ─── AgentTask (partial — enough for MCP query guidance) ─────────────────────

export const agentTaskSummarySchema = z.object({
  _id: z.string().optional(),
  id: z.string().optional(),
  orgId: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  status: z
    .enum(['pending', 'in_progress', 'in_review', 'done', 'paused', '', null as any])
    .optional()
    .describe('Task status. "in_review" = finished by the assignee, waiting for a reviewer to approve it.'),
  priority: z.number().int().min(1).max(5).optional().describe('Urgency 1..5 — 1 Baja, 2 Media (default), 3 Alta, 4 Importante, 5 Crítica. Sort descending.'),
  taskNumber: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Correlative number of the task WITHIN its assignee\'s sequence — "la tarea 7 de Borges". Assigned by the backend on creation and never reused; do not set it by hand. It is NOT unique globally: always pair it with the assignee (and orgId) when querying, or you will match other people\'s task 7.'
    ),
  taskType: z.enum(['review_task', 'create_content', 'human_task']).optional(),
  assignedType: z.enum(['agent', 'user']).optional(),
  assignedTo: assignedToSchema.optional(),
  agentCard: agentCardMinimalSchema.optional().describe('Derived from the agentic profile on save; do not set it by hand.'),
  agenticProfileId: z.string().optional().describe('Flat indexed mirror of agenticProfile.id'),
  agenticProfile: agenticProfileMinimalSchema.optional().describe('Canonical agent assignment — set this to assign a task to an agent'),
});

// ─── AgentOutcomeJob (partial — enough for MCP query guidance) ───────────────

export const agentOutcomeJobSummarySchema = z.object({
  _id: z.string().optional(),
  id: z.string().optional(),
  task: agentTaskSummarySchema.partial().optional().describe('Nested task snapshot — query with "task._id", "task.name"'),
  agentCard: agentCardMinimalSchema.partial().optional().describe('Nested agent card — query with "agentCard.id", "agentCard.name"'),
  messages: z.array(messageAISchema).optional(),
  response: messageAISchema.optional(),
  result: z.unknown().optional().describe('Structured AI output object'),
  responseFormat: z.string().optional(),
  sources: z.array(sourceTaskSchema).optional(),
  infoFromSources: z.string().optional(),
  inputNodeId: z.string().optional(),
});

// ─── Inferred types (re-exported for convenience) ────────────────────────────

export type AssignedUserSchema = z.infer<typeof assignedUserSchema>;
export type AgentTaskSummarySchema = z.infer<typeof agentTaskSummarySchema>;
export type AgentOutcomeJobSummarySchema = z.infer<typeof agentOutcomeJobSummarySchema>;
