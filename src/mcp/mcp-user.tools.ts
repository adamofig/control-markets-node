import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { AppUserService } from '../user/user.service';

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
  query: z.record(z.string(), z.unknown()).optional().describe('MongoDB filter (e.g. { "email": "user@example.com" }).'),
  payload: z.unknown().optional().describe('Document for create, update payload, or aggregate pipeline array.'),
  projection: z.record(z.string(), z.unknown()).optional().describe('Fields to include/exclude (e.g. { "email": 1, "personalData": 1 }).'),
  options: z.record(z.string(), z.unknown()).optional().describe('Mongoose options (e.g. { "sort": { "createdAt": -1 }, "limit": 20 }).'),
});

type OperationInput = z.infer<typeof operationSchema>;

@Injectable()
export class McpUserTools {
  constructor(private userService: AppUserService) {}

  @Tool({
    name: 'users_operation',
    description: `Execute any MongoDB operation on the users collection.
Key fields:
  email          — Unique user email address.
  fbId           — Firebase UID.
  urlPicture     — Avatar URL.
  authStrategy   — Sign-in provider (e.g. "google.com", "password").
  defaultOrgId   — The user's currently active organization ID.
  organizations  — Array of { orgId, name, roles[] } objects for orgs the user belongs to.
  personalData   — Nested object: { firstname, lastname, nickname, gender, birthday }.
  settings       — Nested object with language, notifications, and conversation preferences.
  claims         — Auth claims: { plan, permissions, roles, userId }.

Dot-notation for nested queries: "personalData.firstname", "organizations.orgId", "settings.baseLanguage".
Use users_findByEmail / users_findById for common lookups — they handle the query for you.`,
    parameters: operationSchema,
  })
  async usersOperation(operation: OperationInput) {
    const result = await this.userService.executeOperation(operation);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @Tool({
    name: 'users_findByEmail',
    description: `Find a single user by their email address.
Returns the full user document including personalData, settings, organizations, and claims.`,
    parameters: z.object({
      email: z.string().describe('The email address of the user to look up.'),
    }),
  })
  async findByEmail({ email }: { email: string }) {
    const result = await this.userService.findUserByEmail(email);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @Tool({
    name: 'users_findById',
    description: `Find a single user by their internal user ID (the id field, not the MongoDB _id).
Returns a partial user document. Use users_findByEmail if you have the email instead.`,
    parameters: z.object({
      userId: z.string().describe('The internal user ID (id field).'),
    }),
  })
  async findById({ userId }: { userId: string }) {
    const result = await this.userService.findUserById(userId);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @Tool({
    name: 'users_updateByEmail',
    description: `Update a user's fields by their email address.
Provide only the fields to change in the payload — uses $set internally.
Common use cases: update personalData, settings, defaultOrgId.
Do NOT use this to manage organization membership — use org_operateUser for that.`,
    parameters: z.object({
      email: z.string().describe('Email of the user to update.'),
      payload: z.record(z.string(), z.unknown()).describe('Fields to update (e.g. { "defaultOrgId": "abc123", "personalData.nickname": "Dev" }).'),
    }),
  })
  async updateByEmail({ email, payload }: { email: string; payload: Record<string, unknown> }) {
    const result = await this.userService.updateUserByEmail(email, payload);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
}
