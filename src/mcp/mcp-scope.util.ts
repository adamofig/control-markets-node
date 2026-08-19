import { ForbiddenException, Logger, UnauthorizedException } from '@nestjs/common';
import { IRequestOrgContext } from '../auth/org-context.service';
import * as OrgScope from '../auth/org-scope.rules';
import { IMcpAuthContext, McpAuthContextGuard } from './mcp-auth-context.guard';

/**
 * What every MCP tool calls before it touches a collection.
 *
 * The rule this file exists to make unavoidable:
 *
 * > **A tool never takes its organization from its arguments.** The arguments come from a language
 * > model, which is to say from the conversation, which is to say from whoever is talking to it.
 * > The organization comes from the token, resolved by the server, verified against Mongo membership.
 *
 * The rewriting itself is **not implemented here** — it is `auth/org-scope.rules.ts`, the same table
 * F14a's `OrgScopeInterceptor` uses for REST. Two transports, one rulebook. A second implementation
 * would be a second place to get `aggregate` wrong.
 */

const logger = new Logger('McpScope');

/**
 * The identity of the caller, or a refusal.
 *
 * **Fails closed by construction.** If `McpAuthContextGuard` did not run — because a future refactor
 * dropped it from `McpModule.forRoot`, or because Nest silently skipped a guard it could not resolve
 * — there is no identity on the request and every tool throws here instead of running unscoped.
 * That is deliberate: the failure mode of the guard is silence, so the tools must not assume it.
 */
export function requireMcpContext(request: any): IMcpAuthContext {
  const identity: IMcpAuthContext | undefined = request?.[McpAuthContextGuard.BRIDGE_KEY];
  if (!identity?.orgId) {
    logger.error('[MCP_NO_IDENTITY] a tool ran without a resolved organization — refusing. Is McpAuthContextGuard still registered in McpModule.forRoot?');
    throw new UnauthorizedException(
      'This MCP tool could not resolve who is calling it. Reconnect sending `Authorization: Bearer cm_pat_...`.',
    );
  }
  return identity;
}

/** Adapts the MCP identity to the shape the shared rules expect. */
function asOrgContext(identity: IMcpAuthContext): IRequestOrgContext {
  return {
    userId: identity.userId,
    email: identity.email,
    orgId: identity.orgId,
    role: identity.role as any,
    permissions: identity.permissions,
    isPlatformAdmin: identity.isPlatformAdmin,
    isPersonalSpace: identity.isPersonalSpace,
  };
}

function report(identity: IMcpAuthContext, tool: string): OrgScope.OrgScopeReporter {
  return (where, claimed) =>
    logger.warn(`[ORG_SCOPE_OVERRIDE] mcp:${tool} | actor=${identity.email || '-'} | at=${where} | claimed=${String(claimed)} | resolved=${identity.orgId}`);
}

/**
 * Rewrites a `{ action, query, payload }` operation so it can only touch the caller's organization.
 *
 * `logOnly` is **not** honoured here, and that is a decision rather than an omission.
 * `SECURITY_ORG_SCOPE_LOG_ONLY` is F14a's rollout knob for REST traffic that predates the scoping and
 * had to be observed before being enforced. MCP scoping ships enforced from its first request: there
 * is no legacy behavior to phase out, and a flag that could silently unscope a tool would be a way to
 * turn this task off.
 */
export function scopeMcpOperation<T>(operation: T, identity: IMcpAuthContext, tool: string, orgField?: string): T {
  if (OrgScope.isAdminBypass(operation, asOrgContext(identity))) {
    logger.warn(`[ADMIN_BYPASS] mcp:${tool} | actor=${identity.email} | action=${(operation as any)?.action} | org scope not applied`);
    return operation;
  }
  OrgScope.scopeOperation(operation, asOrgContext(identity), report(identity, tool), { logOnly: false, orgField });
  return operation;
}

/**
 * Refuses a write action on a platform-level collection unless the caller is a platform admin.
 *
 * `users` and `organizations` are not org-owned data the way `agent_tasks` or `social_media_tracker`
 * are: they *describe* tenancy rather than live inside it. A scoped read is a coherent thing to allow
 * a member — "who is on my team" — but an arbitrary `updateMany` over the users collection, issued
 * from a chat, is not something an org role should be able to reach. Reads stay scoped; writes need
 * platform access, and the refusal names the tool that does the job properly.
 */
export function requirePlatformAdminForWrite(operation: any, identity: IMcpAuthContext, tool: string, insteadUse: string): void {
  const action = operation?.action;
  if (!action || OrgScope.READ_ACTIONS.has(action) || action === 'aggregate') return;
  if (identity.isPlatformAdmin) {
    logger.warn(`[ADMIN_BYPASS] mcp:${tool} | actor=${identity.email} | write action '${action}' on a platform collection`);
    return;
  }
  logger.warn(`[ORG_SCOPE_DENIED] mcp:${tool} | actor=${identity.email || '-'} | write action '${action}' refused (not a platform admin)`);
  throw new ForbiddenException(
    `\`${tool}\` only reads for non-platform-admins. To change this, use ${insteadUse}, which enforces the business rules.`,
  );
}

/**
 * Strips the fields of a user document that decide who someone *is* on the platform.
 *
 * `users_updateByEmail` accepts an arbitrary payload. Left alone, `{ claims: { roles: { admin: null } } }`
 * is a one-call promotion to platform admin, and `{ organizations: [...] }` is a one-call membership
 * grant to any tenant. Neither belongs on a generic update tool reachable from a conversation.
 */
export function stripPrivilegeFields(payload: Record<string, unknown>, identity: IMcpAuthContext, tool: string): Record<string, unknown> {
  if (identity.isPlatformAdmin) return payload;
  const sanitized = { ...payload };
  for (const field of ['claims', 'organizations', 'token', 'roles']) {
    for (const key of Object.keys(sanitized)) {
      if (key === field || key.startsWith(`${field}.`)) {
        logger.warn(`[PRIVILEGE_FIELD_STRIPPED] mcp:${tool} | actor=${identity.email || '-'} | field=${key}`);
        delete sanitized[key];
      }
    }
  }
  return sanitized;
}

/** A Mongo filter restricted to the caller's organization, for tools that build their query by hand. */
export function scopedQuery(identity: IMcpAuthContext, query: Record<string, any> = {}): Record<string, any> {
  return { ...query, orgId: identity.orgId };
}

/**
 * Resolves which organization a tool that takes an explicit `orgId` argument may act on.
 *
 * Three tools legitimately name an organization — `org_getMembers`, `org_operateUser` and
 * `messaging_notifyUser`. Their argument is now a *request*, not an assertion:
 *
 * - absent, or equal to the caller's organization → the caller's organization;
 * - different, and the caller is a platform admin → allowed, and logged as `[ADMIN_BYPASS]`, the same
 *   convention the rest of the codebase uses for a credential that crosses tenants;
 * - different, and the caller is not → refused. Not "silently corrected": a tool that quietly acts on
 *   a different organization than the one it was told is worse than one that fails.
 */
export function resolveOrgArgument(claimed: string | undefined, identity: IMcpAuthContext, tool: string): string {
  if (!claimed || claimed === identity.orgId) return identity.orgId;

  if (identity.isPlatformAdmin) {
    logger.warn(`[ADMIN_BYPASS] mcp:${tool} | actor=${identity.email} | acting on org ${claimed} instead of ${identity.orgId}`);
    return claimed;
  }

  logger.warn(`[ORG_SCOPE_DENIED] mcp:${tool} | actor=${identity.email || '-'} | claimed=${claimed} | resolved=${identity.orgId}`);
  throw new ForbiddenException(
    `You asked for organization ${claimed} but this token is scoped to ${identity.orgId}. Switch organization with the \`x-org-id\` header of one you belong to.`,
  );
}

/**
 * Refuses a document that belongs to another organization.
 *
 * For the by-id tools (`flow_getFlow`, `tasks_executeTask`, `users_findById`, …) there is no filter to
 * rewrite — the id *is* the query. The check happens after the read, mirroring what
 * `OrgScopeInterceptor.scopeResponse` does for `GET /:id`. A document with no `orgId` at all is not
 * org-scoped and passes untouched, same rule as there.
 */
export function assertDocumentInOrg<T>(document: T, identity: IMcpAuthContext, tool: string, what: string): T {
  const orgId = (document as any)?.orgId;
  if (document && orgId !== undefined && orgId !== identity.orgId && !identity.isPlatformAdmin) {
    logger.warn(`[ORG_SCOPE_DENIED] mcp:${tool} | actor=${identity.email || '-'} | ${what} belongs to ${orgId}, caller is in ${identity.orgId}`);
    // Deliberately the same message whether it exists elsewhere or not exists at all — telling the
    // difference would be an existence oracle over every tenant, the same reasoning as `cm://`.
    throw new ForbiddenException(`${what} was not found in your organization.`);
  }
  return document;
}
