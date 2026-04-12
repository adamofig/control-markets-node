import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { AgentTasksService } from '../agent-tasks/services/agent-tasks.service';
import { AgentOutcomeJobService } from '../agent-tasks/services/agent-job.service';
import { assignedUserSchema, agentTaskSummarySchema, agentOutcomeJobSummarySchema } from '../agent-tasks/models/task-schemas';

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
  query: z.record(z.string(), z.unknown()).optional().describe('MongoDB filter (e.g. { "status": "done" }).'),
  payload: z.unknown().optional().describe('Document for create, update payload, or aggregate pipeline array.'),
  projection: z.record(z.string(), z.unknown()).optional().describe('Fields to include/exclude (e.g. { "name": 1, "messages": 0 }).'),
  options: z.record(z.string(), z.unknown()).optional().describe('Mongoose options (e.g. { "sort": { "createdAt": -1 }, "limit": 20 }).'),
});

type OperationInput = z.infer<typeof operationSchema>;

@Injectable()
export class McpTasksTools {
  constructor(
    private agentTasksService: AgentTasksService,
    private agentJobService: AgentOutcomeJobService,
  ) {}

  // ─── Schema introspection ────────────────────────────────────────────────

  @Tool({
    name: 'tasks_getSchema',
    description: `Returns the JSON Schema for both agent_tasks and agent_outcome_jobs collections.
Call this first when you are unsure about field names, nested object shapes, or valid enum values.
The schema is derived directly from the TypeScript models — it is always up to date.`,
    parameters: z.object({}),
  })
  async getSchema() {
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
Fields: name, description, status (e.g. "pending"|"done"|"in_progress"), orgId,
taskType ("review_task"|"create_content"|"human_task"),
assignedType ("agent"|"user"),
assignedTo {userId, email, name} — nested object, always query with dot-notation:
"assignedTo.name", "assignedTo.email", "assignedTo.userId".
Note: in order to create, orgId is a must, ask user for it.
`,

    parameters: operationSchema,
  })
  async tasksOperation(operation: OperationInput) {
    const result = await this.agentTasksService.executeOperation(operation);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }


  @Tool({
    name: 'tasks_getByAssignee',
    description: `Find all tasks assigned to a specific user.
Handles the nested assignedTo object query internally — no need to know the dot-notation path.
Optionally filter by status.`,
    parameters: z.object({
      userId: assignedUserSchema.shape.userId.optional().describe('Firebase UID (assignedTo.userId)'),
      email: assignedUserSchema.shape.email.optional().describe('User email (assignedTo.email)'),
      name: assignedUserSchema.shape.name.optional().describe('Display name (assignedTo.name)'),
      status: agentTaskSummarySchema.shape.status,
    }),
  })
  async getTasksByAssignee({ userId, email, name, status }: { userId?: string; email?: string; name?: string; status?: string }) {
    const query: Record<string, unknown> = {};
    if (userId) query['assignedTo.userId'] = userId;
    else if (email) query['assignedTo.email'] = email;
    else if (name) query['assignedTo.name'] = name;
    if (status) query['status'] = status;
    const result = await this.agentTasksService.executeOperation({ action: 'find', query });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @Tool({
    name: 'tasks_executeTask',
    description: `Execute an agent task by ID. Only valid if the task have an agent card associated. Runs the task against its configured agent cards and sources. Returns the outcome job(s) with AI-generated content.`,
    parameters: z.object({
      taskId: z.string().describe('The ID of the agent task to execute.'),
    }),
  })
  async executeAgentTask({ taskId }: { taskId: string }) {
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
  async jobsOperation(operation: OperationInput) {
    const result = await this.agentJobService.executeOperation(operation);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
}
