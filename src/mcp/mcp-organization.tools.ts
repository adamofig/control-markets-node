import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { OrganizationService } from '../organization/services/organization.service';

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
  query: z.record(z.string(), z.unknown()).optional().describe('MongoDB filter (e.g. { "type": "personal" }).'),
  payload: z.unknown().optional().describe('Document for create, update payload, or aggregate pipeline array.'),
  projection: z.record(z.string(), z.unknown()).optional().describe('Fields to include/exclude (e.g. { "name": 1, "guests": 0 }).'),
  options: z.record(z.string(), z.unknown()).optional().describe('Mongoose options (e.g. { "sort": { "createdAt": -1 }, "limit": 20 }).'),
});

type OperationInput = z.infer<typeof operationSchema>;

@Injectable()
export class McpOrganizationTools {
  constructor(private organizationService: OrganizationService) {}

  @Tool({
    name: 'org_operation',
    description: `Execute any MongoDB operation on the organizations collection.
Key fields:
  name       — Human-readable org name (Personal Spaces use the owner's email as name).
  type       — "personal" for a user's default space, otherwise a custom string.
  guests     — Array of { userId, email } objects representing org members.
  socialNetworks — Array of { type, account } for linked social accounts.
  description, image — Optional metadata.

Dot-notation for nested queries: "guests.email", "guests.userId", "socialNetworks.type".
Use org_getMembers / org_operateUser for member management — they handle the nested logic for you.`,
    parameters: operationSchema,
  })
  async orgOperation(operation: OperationInput) {
    const result = await this.organizationService.executeOperation(operation);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @Tool({
    name: 'org_getMembers',
    description: `Return all members (guests) of a specific organization.
Provide the organization's MongoDB _id. Returns the guests array with userId and email for each member.`,
    parameters: z.object({
      orgId: z.string().describe('MongoDB _id of the organization.'),
    }),
  })
  async getMembers({ orgId }: { orgId: string }) {
    const result = await this.organizationService.executeOperation({
      action: 'findOne',
      query: { _id: orgId },
      projection: { name: 1, type: 1, guests: 1 },
    });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @Tool({
    name: 'org_findByUser',
    description: `Find all organizations a user belongs to by their email address.
Queries the guests array using dot-notation. Returns all matching organizations.`,
    parameters: z.object({
      email: z.string().describe('Email address of the user.'),
    }),
  })
  async findByUser({ email }: { email: string }) {
    const result = await this.organizationService.executeOperation({
      action: 'find',
      query: { 'guests.email': email },
      projection: { name: 1, type: 1, description: 1 },
    });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @Tool({
    name: 'org_operateUser',
    description: `Add or remove a user from an organization.
  operation "add"    — Adds the user to the org's guests list and embeds the org into the user's organizations array.
  operation "remove" — Reverts both; if the org was the user's defaultOrgId, falls back to their personal space.`,
    parameters: z.object({
      orgId: z.string().describe('MongoDB _id of the organization.'),
      email: z.string().describe('Email of the user to add or remove.'),
      operation: z.enum(['add', 'remove']).describe('"add" to grant access, "remove" to revoke.'),
    }),
  })
  async operateUser({ orgId, email, operation }: { orgId: string; email: string; operation: 'add' | 'remove' }) {
    const result = await this.organizationService.operateUserToOrganization(orgId, { email, operation });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
}
