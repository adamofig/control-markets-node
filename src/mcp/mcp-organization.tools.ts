import { Injectable } from '@nestjs/common';
import { Tool, ToolScopes } from '@rekog/mcp-nest';
import { z } from 'zod';
import { OrganizationService } from '../organization/services/organization.service';
import { OrgUserOperation } from '../organization/models/organization-member.models';
import { OrgRole } from '../user/user.class';

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
  query: z.preprocess(preprocessJson, z.record(z.string(), z.unknown())).optional().describe('MongoDB filter (e.g. { "type": "personal" }).'),
  payload: z.preprocess(preprocessJson, z.unknown()).optional().describe('Document for create, update payload, or aggregate pipeline array.'),
  projection: z.preprocess(preprocessJson, z.record(z.string(), z.unknown())).optional().describe('Fields to include/exclude (e.g. { "name": 1, "guests": 0 }).'),
  options: z.preprocess(preprocessJson, z.record(z.string(), z.unknown())).optional().describe('Mongoose options (e.g. { "sort": { "createdAt": -1 }, "limit": 20 }).'),
});

type OperationInput = z.infer<typeof operationSchema>;

import { requireMcpContext, requirePlatformAdminForWrite, resolveOrgArgument, scopeMcpOperation } from './mcp-scope.util';
import { MCP_SCOPES } from './mcp-scopes';

@Injectable()
export class McpOrganizationTools {
  constructor(private organizationService: OrganizationService) {}

  @ToolScopes([MCP_SCOPES.org])
  @Tool({
    name: 'org_operation',
    description: `Execute any MongoDB operation on the organizations collection.
Key fields:
  name       — Human-readable org name (Personal Spaces use the owner's email as name).
  type       — "personal" for a user's default space, otherwise a custom string.
  socialNetworks — Array of { type, account } for linked social accounts.
  description, image — Optional metadata.
  guests     — DEPRECATED mirror of the member list, removed in F16. Do NOT read it: membership and
               roles live in users.organizations[]. Use org_getMembers / org_findByUser instead.

Dot-notation for nested queries: "socialNetworks.type".
Use org_getMembers / org_operateUser for member management — they handle the nested logic for you.`,
    parameters: operationSchema,
  })
  async orgOperation(operation: OperationInput, _context: unknown, request: any) {
    const identity = requireMcpContext(request);
    requirePlatformAdminForWrite(operation, identity, 'org_operation', '`org_operateUser`');
    // The organizations collection *is* the tenant, so its link to one is its own `id` — there is no
    // `orgId` field to filter on. A member reads their own organization and nothing else.
    scopeMcpOperation(operation, identity, 'org_operation', 'id');
    const result = await this.organizationService.executeOperation(operation);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @ToolScopes([MCP_SCOPES.org])
  @Tool({
    name: 'org_getMembers',
    description: `Return all members of a specific organization, with their role.
Provide the organization's MongoDB _id. Returns { userId, email, fullName, displayName, role, status }
for each member, resolved from users.organizations[] — the source of truth, not the deprecated guests array.`,
    parameters: z.object({
      orgId: z.string().optional().describe('MongoDB _id of the organization. Defaults to yours; naming another one requires platform access.'),
    }),
  })
  async getMembers({ orgId }: { orgId?: string }, _context: unknown, request: any) {
    const resolved = resolveOrgArgument(orgId, requireMcpContext(request), 'org_getMembers');
    const result = await this.organizationService.getMembers(resolved);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @ToolScopes([MCP_SCOPES.org])
  @Tool({
    name: 'org_findByUser',
    description: `Find all organizations a user belongs to by their email address.
Resolved from the user's memberships (users.organizations[]). Returns each organization with the
role that person holds in it.`,
    parameters: z.object({
      email: z.string().describe('Email address of the user.'),
    }),
  })
  async findByUser({ email }: { email: string }, _context: unknown, request: any) {
    const identity = requireMcpContext(request);
    const all = await this.organizationService.findOrganizationsByUserEmail(email);
    // Answering with every organization a person belongs to would map the platform's tenants from
    // any single token. A member sees only the intersection with their own organization; a platform
    // admin sees the whole list, which is what the admin screens need.
    const result = identity.isPlatformAdmin
      ? all
      : (Array.isArray(all) ? all : []).filter((org: any) => (org?.id ?? org?._id?.toString()) === identity.orgId);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  @ToolScopes([MCP_SCOPES.org])
  @Tool({
    name: 'org_operateUser',
    description: `Manage a user's membership in an organization.
  operation "add"            — Grants access with a role (default "member"). An email without an
                               account is INVITED, not rejected: the membership activates on first sign-in.
  operation "remove"         — Revokes access; if the org was the user's defaultOrgId, falls back to
                               their personal space.
  operation "update-role"    — Changes an existing member's role.
  operation "update-profile" — Sets the per-organization display name override.

Business invariants apply here too (they live in the service, not in a guard): the last Owner cannot
be removed or demoted, and nobody can be granted a role above the caller's own.`,
    parameters: z.object({
      orgId: z.string().optional().describe('MongoDB _id of the organization. Defaults to yours; naming another one requires platform access.'),
      email: z.string().describe('Email of the user to operate on.'),
      operation: z.enum(['add', 'remove', 'update-role', 'update-profile']).describe('What to do with the membership.'),
      role: z.enum(['owner', 'admin', 'member', 'viewer']).optional().describe('Role for "add" (default "member") and "update-role".'),
      displayName: z.string().optional().describe('Per-organization name override, for "update-profile".'),
    }),
  })
  async operateUser({
    orgId,
    email,
    operation,
    role,
    displayName,
  }: {
    orgId?: string;
    email: string;
    operation: OrgUserOperation;
    role?: OrgRole;
    displayName?: string;
  }, _context: unknown, request: any) {
    // The business invariants (last owner, no role above your own) live in the service and still
    // apply. What is added here is *which* organization the caller may run them against.
    const resolved = resolveOrgArgument(orgId, requireMcpContext(request), 'org_operateUser');
    const result = await this.organizationService.operateUserToOrganization(resolved, { email, operation, role, displayName });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
}
