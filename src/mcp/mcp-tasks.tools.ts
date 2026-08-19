import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { AgentTasksService } from '../agent-tasks/services/agent-tasks.service';
import { SubtaskStatus } from '../agent-tasks/models/classes';
import { AgentOutcomeJobService } from '../agent-tasks/services/agent-job.service';
import { assignedUserSchema, agentTaskSummarySchema, agentOutcomeJobSummarySchema } from '../agent-tasks/models/task-schemas';
import { assertDocumentInOrg, requireMcpContext, scopeMcpOperation, scopedQuery } from './mcp-scope.util';

const preprocessJson = (val: unknown) => {
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  return val;
};

// Shared operation schema — mirrors OperationDto from @dataclouder/nest-mongo
const operationSchema = z.object({
  action: z
    .enum(['find', 'findOne', 'create', 'updateOne', 'updateMany', 'deleteOne', 'aggregate', 'clone'])
    .describe(
      `MongoDB operation.
find/findOne → use query, projection, options.
create → use payload.
updateOne/updateMany → use query + payload (supports $set, $push, etc).
deleteOne → use query.
aggregate → use payload as pipeline array.
clone → use query with _id.`,
    ),
  query: z.preprocess(preprocessJson, z.record(z.string(), z.unknown())).optional().describe('MongoDB filter (e.g. { "status": "done" }).'),
  payload: z.preprocess(preprocessJson, z.unknown()).optional().describe('Document for create, update payload, or aggregate pipeline array.'),
  projection: z.preprocess(preprocessJson, z.record(z.string(), z.unknown())).optional().describe('Fields to include/exclude (e.g. { "name": 1, "messages": 0 }).'),
  options: z.preprocess(preprocessJson, z.record(z.string(), z.unknown())).optional().describe('Mongoose options (e.g. { "sort": { "createdAt": -1 }, "limit": 20 }).'),
});

type OperationInput = z.infer<typeof operationSchema>;

@Injectable()
export class McpTasksTools {
  constructor(
    private agentTasksService: AgentTasksService,
    private agentJobService: AgentOutcomeJobService,
  ) {}

  // ─── Schema introspection ────────────────────────────────────────────────

  /**
   * Ownership of a task addressed by id.
   *
   * `updateSubtaskStatus` and `execute` take a bare `taskId` — there is no filter to rewrite, so the
   * document is read under the caller's organization first and the write only happens if it is
   * there. `execute` matters most: it runs an LLM and bills for it.
   */
  private async assertTaskOwned(taskId: string, request: any, tool: string): Promise<void> {
    const identity = requireMcpContext(request);
    const [task] = await this.agentTasksService.executeOperation({
      action: 'find',
      query: { id: taskId, orgId: identity.orgId },
      options: { limit: 1, projection: { id: 1, orgId: 1 } },
    });
    if (!task) {
      // Same message for "belongs to another org" and "does not exist" — an existence oracle over
      // other tenants is not worth a better error message.
      assertDocumentInOrg({ orgId: '__missing__' }, identity, tool, `Task ${taskId}`);
    }
  }

  @Tool({
    name: 'tasks_getSchema',
    description: `Returns the JSON Schema for both agent_tasks and agent_outcome_jobs collections.
Call this first when you are unsure about field names, nested object shapes, or valid enum values.
The schema is derived directly from the TypeScript models — it is always up to date.`,
    parameters: z.object({}),
  })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getSchema(_args: unknown, _context: unknown, _request: any) {
    const schema = {
      agent_tasks: z.toJSONSchema(agentTaskSummarySchema),
      agent_outcome_jobs: z.toJSONSchema(agentOutcomeJobSummarySchema),
    };
    return { content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }] };
  }

  // ─── agent_tasks collection ──────────────────────────────────────────────

  

  @Tool({
    name: 'tasks_operation',
    description: `Execute any MongoDB operation on the agent_tasks collection.
Call tasks_getSchema first if you are unsure of field names or nested shapes. Here are only the basic fields, so user request make sense:
Fields: name, description, status ("pending"|"in_progress"|"in_review"|"done"|"paused"|""|null), orgId,
priority (number 1..5 — 1 Baja, 2 Media (default), 3 Alta, 4 Importante, 5 Crítica; higher is more urgent),
taskNumber (correlative number inside the ASSIGNEE's own sequence — see below),
taskType ("review_task"|"create_content"|"human_task"),
assignedType ("agent"|"user"),
assignedTo {userId, email, name} — nested object, always query with dot-notation:
"assignedTo.name", "assignedTo.email", "assignedTo.userId".
Note: in order to create, orgId is a must, ask user for it.
taskNumber is assigned automatically on creation and never reused — do NOT send it yourself.
It is scoped per assignee, NOT global: "tarea 7" only means something together with whose task 7 it is.
Examples: urgent backlog → query { "priority": { "$gte": 4 }, "status": { "$ne": "done" } } with options { "sort": { "priority": -1 } };
pending review → query { "status": "in_review" };
"la tarea 7 de Borges" → query { "orgId": "<org>", "taskNumber": 7, "$or": [ { "agentCard.id": "<cardId>" }, { "assignedTo.id": "<cardId>" } ] };
"mi tarea 3" for a human → query { "orgId": "<org>", "taskNumber": 3, "assignedTo.userId": "<uid>" }.
`,

    parameters: operationSchema,
  })
  async tasksOperation(operation: OperationInput, _context: unknown, request: any) {
    scopeMcpOperation(operation, requireMcpContext(request), 'tasks_operation');
    const result = await this.agentTasksService.executeOperation(operation);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }


  @Tool({
    name: 'tasks_getByAssignee',
    description: `Find all tasks assigned to a specific user.
Handles the nested assignedTo object query internally — no need to know the dot-notation path.
Optionally filter by status (use "in_review" for work waiting on approval) and/or by minimum priority.
Pass taskNumber to resolve a phrase like "mi tarea 3" / "la tarea 3 de Kenya": the number counts
inside THIS user's own sequence, so it is only unambiguous together with the user identity here.
Results come back sorted by priority descending (most urgent first).`,
    parameters: z.object({
      userId: assignedUserSchema.shape.userId.optional().describe('Firebase UID (assignedTo.userId)'),
      email: assignedUserSchema.shape.email.optional().describe('User email (assignedTo.email)'),
      name: assignedUserSchema.shape.name.optional().describe('Display name (assignedTo.name)'),
      status: agentTaskSummarySchema.shape.status,
      minPriority: z.number().int().min(1).max(5).optional().describe('Only tasks with priority >= this value (1..5).'),
      taskNumber: z.number().int().positive().optional().describe("The task's correlative number within this user's sequence (e.g. 3 for \"mi tarea 3\")."),
    }),
  })
  async getTasksByAssignee({
    userId,
    email,
    name,
    status,
    minPriority,
    taskNumber,
  }: {
    userId?: string;
    email?: string;
    name?: string;
    status?: string;
    minPriority?: number;
    taskNumber?: number;
  }, _context: unknown, request: any) {
    const identity = requireMcpContext(request);
    // The task numbering is correlative *per assignee inside an organization*, so scoping this query
    // is not only an access rule: without it "mi tarea 3" could match a different person's #3 in
    // another tenant and answer with the wrong task.
    const query: Record<string, unknown> = scopedQuery(identity);
    // Legacy rows written by Angular put the uid in `assignedTo.id`; match both or a user's early
    // tasks silently drop out of their own sequence.
    if (userId) query['$or'] = [{ 'assignedTo.userId': userId }, { 'assignedTo.id': userId }];
    else if (email) query['assignedTo.email'] = email;
    else if (name) query['assignedTo.name'] = name;
    if (status) query['status'] = status;
    if (minPriority) query['priority'] = { $gte: minPriority };
    if (taskNumber) query['taskNumber'] = taskNumber;
    const result = await this.agentTasksService.executeOperation({ action: 'find', query, options: { sort: { priority: -1 } } });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @Tool({
    name: 'tasks_updateSubtaskStatus',
    description: `Mark a subtask of an agent task as done or pending. Subtasks are the structured checklist items of a task (synced from the markdown "- [ ]" checkboxes or created in the UI).
When all subtasks are done the parent task is auto-completed; reopening one moves a done parent back to in_progress.
Use tasks_operation (findOne with projection { "subtasks": 1 }) to list a task's subtasks and their ids first.`,
    parameters: z.object({
      taskId: z.string().describe('The ID of the parent agent task.'),
      subtaskId: z.string().describe('The ID of the subtask (e.g. "md-a1b2c3d4e5f6" for markdown-synced ones).'),
      status: z.enum(['pending', 'done']).describe('New status for the subtask.'),
      completedBy: z.string().optional().describe('Email of the user or name of the agent completing it.'),
    }),
  })
  async updateSubtaskStatus(
    { taskId, subtaskId, status, completedBy }: { taskId: string; subtaskId: string; status: SubtaskStatus; completedBy?: string },
    _context: unknown,
    request: any,
  ) {
    await this.assertTaskOwned(taskId, request, 'tasks_updateSubtaskStatus');
    const result = await this.agentTasksService.updateSubtaskStatus(taskId, subtaskId, status, completedBy);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @Tool({
    name: 'tasks_executeTask',
    description: `Execute an agent task by ID. Only valid if the task have an agent card associated. Runs the task against its configured agent cards and sources. Returns the outcome job(s) with AI-generated content.`,
    parameters: z.object({
      taskId: z.string().describe('The ID of the agent task to execute.'),
    }),
  })
  async executeAgentTask({ taskId }: { taskId: string }, _context: unknown, request: any) {
    await this.assertTaskOwned(taskId, request, 'tasks_executeTask');
    const result = await this.agentTasksService.execute(taskId);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  // ─── agent_outcome_jobs collection ───────────────────────────────────────

  @Tool({
    name: 'tasks_jobsOperation',
    description: `Execute any MongoDB operation on the agent_outcome_jobs collection.
Use this to find jobs by task ID, filter by date, retrieve AI-generated responses, or aggregate results.
Call tasks_getSchema first if you are unsure of field names or nested shapes.
Key reminder: task and agentCard are nested — query with "task._id", "task.name", "agentCard.id", "agentCard.name".`,
    parameters: operationSchema,
  })
  async jobsOperation(operation: OperationInput, _context: unknown, request: any) {
    scopeMcpOperation(operation, requireMcpContext(request), 'tasks_jobsOperation');
    const result = await this.agentJobService.executeOperation(operation);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
}
