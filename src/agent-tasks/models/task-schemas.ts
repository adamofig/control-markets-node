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
  status: z.string().optional().describe('Free string, e.g. "pending" | "done" | "in_progress"'),
  taskType: z.enum(['review_task', 'create_content', 'human_task']).optional(),
  assignedType: z.enum(['agent', 'user']).optional(),
  assignedTo: assignedToSchema.optional(),
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
