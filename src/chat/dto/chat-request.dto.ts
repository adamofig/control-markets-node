import { z } from 'zod';

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const capabilitySchema = z.object({
  key: z.string().min(1).max(120),
  label: z.string().min(1).max(256),
  description: z.string().max(1024),
  type: z.enum(['read', 'navigate', 'command']),
  enabled: z.boolean(),
  disabledReason: z.string().max(512).optional(),
  requiresConfirmation: z.boolean().optional(),
}).strict();

const entitySchema = z.object({
  entityType: z.string().min(1).max(120),
  collection: z.string().max(120).optional(),
  id: z.string().max(256).optional(),
  label: z.string().max(1024).optional(),
  state: z.enum(['loaded', 'loading', 'new', 'missing']).optional(),
  summary: z.record(z.string(), jsonValueSchema).optional(),
}).strict();

const selectionSchema = z.object({
  kind: z.enum(['entity', 'canvas-node', 'conversation', 'message', 'date', 'tab', 'asset', 'custom']),
  id: z.string().max(256).optional(),
  label: z.string().max(1024).optional(),
  entityType: z.string().max(120).optional(),
  summary: z.record(z.string(), jsonValueSchema).optional(),
}).strict();

export const uiContextSnapshotV1Schema = z.object({
  schemaVersion: z.literal(1),
  capturedAt: z.string().datetime(),
  contextHash: z.string().min(1).max(80),
  navigation: z.object({
    url: z.string().max(2048),
    routeKey: z.string().min(1).max(160),
    sectionKey: z.string().min(1).max(160),
    title: z.string().min(1).max(256),
    description: z.string().max(2048).optional(),
    breadcrumbs: z.array(z.object({ label: z.string().max(256), routeKey: z.string().max(160).optional() }).strict()).max(20).optional(),
  }).strict(),
  view: z.object({
    kind: z.enum(['dashboard', 'list', 'detail', 'form', 'canvas', 'calendar', 'conversation', 'settings', 'custom']),
    mode: z.enum(['list', 'view', 'create', 'edit']).optional(),
    activeTab: z.string().max(256).optional(),
    dialog: z.string().max(256).optional(),
    search: z.string().max(1024).optional(),
    filters: z.record(z.string(), jsonValueSchema).optional(),
    sort: z.record(z.string(), jsonValueSchema).optional(),
    pagination: z.object({ page: z.number().optional(), pageSize: z.number().optional(), total: z.number().optional() }).strict().optional(),
  }).strict(),
  primaryEntity: entitySchema.optional(),
  relatedEntities: z.array(entitySchema).max(20).optional(),
  selections: z.array(selectionSchema).max(10).optional(),
  form: z.object({
    status: z.enum(['pristine', 'dirty', 'saving', 'saved', 'invalid']),
    dirtyFields: z.array(z.string().max(256)).max(100).optional(),
    validationErrors: z.array(z.object({ field: z.string().max(256), code: z.string().max(120) }).strict()).max(100).optional(),
    draft: z.record(z.string(), jsonValueSchema).optional(),
  }).strict().optional(),
  capabilities: z.array(capabilitySchema).max(100),
  suggestions: z.array(z.string().max(512)).max(20).optional(),
  sourceDiagnostics: z.array(z.object({
    sourceId: z.string().min(1).max(160),
    kind: z.string().min(1).max(80),
    priority: z.number(),
    updatedAt: z.string().datetime(),
  }).strict()).max(50),
}).strict();

export const chatRequestV2Schema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(32_000),
  }).strict()).min(1).max(100),
  uiContext: uiContextSnapshotV1Schema.optional(),
  agentCardId: z.string().max(256).optional(),
  conversationId: z.string().max(256).optional(),
}).strict();

export type ChatRequestDto = z.infer<typeof chatRequestV2Schema>;
export type UiContextSnapshotV1 = z.infer<typeof uiContextSnapshotV1Schema>;
