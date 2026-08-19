import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { IRequestOrgContext } from '../auth/org-context.service';
import { IEphemeralAgentGrant } from '../user/ephemeral-agent-token.service';
import { ALL_MCP_SCOPES, McpScope } from './mcp-scopes';

/**
 * Identity at the `/mcp` door — and the bridge that carries it to the tools.
 *
 * ## What was already true, and what was not
 *
 * `/mcp` is **not** an open endpoint: `AuthContextModule` registers `ProjectAuthGuard` and
 * `OrgContextGuard` as `APP_GUARD` (F12), and a global guard covers every route, including the
 * controller `@rekog/mcp-nest` builds at runtime. So a request without a token has been getting 401,
 * and one without a membership 403, since F12 shipped.
 *
 * What was *not* true is that any of that reached the tools. Every `@Tool` took its `orgId` as an
 * argument **from the model**, so a legitimate member of org A could ask for org B and be served —
 * the confused deputy F14a closes for REST, still wide open on this transport.
 *
 * `McpApiKeyGuard` used to live next door and suggested a third story: a shared `MCP_API_KEY`. It was
 * never wired to anything. It is deleted rather than left as a comment, because dead security code
 * is worse than none — it answers "is this protected?" with a confident wrong yes.
 *
 * ## Why this guard has to exist at all, given F12
 *
 * Two reasons, and the second is the load-bearing one:
 *
 * 1. **Defense in depth.** F12's ordering is asserted by a static test, not by the type system. This
 *    guard runs last (route-level guards run after global ones) and refuses a request that arrived
 *    without an identity or without an organization, so a registration-order mistake fails closed
 *    *here* instead of silently unscoping every tool call.
 * 2. **Fastify's `raw`.** `mcp-nest` invokes a tool as `method(args, context, httpRequest.raw)`. Under
 *    the Fastify adapter `httpRequest` is the `FastifyRequest` and `.raw` is the underlying Node
 *    `IncomingMessage` — a *different object* from the one the guards decorated. Everything F12
 *    resolved (`decodedToken`, `orgId`, `ctx`) lives on the Fastify request and is simply not visible
 *    from inside a tool. This guard copies it across. Without the bridge, scoping the tools is not
 *    hard — it is impossible.
 *
 * ## Zero constructor dependencies, on purpose
 *
 * `McpModule.forRoot({ guards })` does not add its guards to `providers`; Nest resolves them from the
 * dynamic module that declares the generated controller. `GuardsContextCreator.getGuardInstance`
 * returns `null` for a guard it cannot resolve and the guard is then **silently skipped** — no error,
 * no log, no protection. A guard with no injected dependencies cannot hit that path.
 *
 * And because "silently skipped" is a failure mode that no test of this class would catch, the tools
 * do not trust that this guard ran: `requireMcpContext()` throws when the bridge is missing. This
 * guard makes the identity available; the tools refuse to work without it.
 */
@Injectable()
export class McpAuthContextGuard implements CanActivate {
  private readonly logger = new Logger('McpAuthContextGuard');

  /** Where the tools read the identity from, on the raw request. Kept in one place, used in two. */
  static readonly BRIDGE_KEY = 'mcpAuthContext';

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    if (!request.decodedToken) {
      throw new UnauthorizedException(
        'MCP requires an authenticated identity. Send `Authorization: Bearer cm_pat_...` (a Personal Access Token) or a Firebase token.',
      );
    }

    const ctx: IRequestOrgContext | undefined = request.ctx;
    const orgId = ctx?.orgId || request.orgId;
    if (!orgId) {
      throw new ForbiddenException(
        'MCP could not resolve an organization for this token. Set a default organization, or send the `x-org-id` header of an organization you belong to.',
      );
    }

    // Task 25 — an ephemeral agent token names exactly one organization, and `OrgContextGuard`
    // resolves `x-org-id` ahead of the `request.orgId` this guard's predecessor pinned. For a human
    // switching workspace that preference is right; for a credential minted for one session it is a
    // way to walk out of the box. The mismatch is refused rather than corrected, because a tool that
    // quietly acts on a different organization than the token names is the failure this whole task
    // exists to prevent.
    const grant: IEphemeralAgentGrant | undefined = request.agentGrant;
    if (grant && orgId !== grant.orgId) {
      this.logger.warn(`[EAT_ORG_MISMATCH] grant=${grant.fingerprint} | session=${grant.sessionId} | granted=${grant.orgId} | requested=${orgId}`);
      throw new ForbiddenException(
        `This agent session token is scoped to organization ${grant.orgId}; the request resolved to ${orgId}. Drop the \`x-org-id\` header.`,
      );
    }

    // What this caller may *do*, as opposed to where. A human's credential carries the whole
    // vocabulary — nothing changes for a PAT, a Firebase session or the master token — while an
    // agent session carries what its grant was minted with.
    const scopes: McpScope[] = grant ? grant.scopes : [...ALL_MCP_SCOPES];

    // The bridge. `raw` is what a tool receives; without this copy the tool sees an anonymous
    // IncomingMessage and — by design — refuses to run.
    const identity: IMcpAuthContext = {
      orgId,
      userId: ctx?.userId ?? request.decodedToken?.userId ?? request.decodedToken?.uid ?? null,
      email: ctx?.email ?? request.decodedToken?.email ?? '',
      role: ctx?.role ?? null,
      permissions: ctx?.permissions ?? [],
      isPlatformAdmin: !!ctx?.isPlatformAdmin,
      isPersonalSpace: !!ctx?.isPersonalSpace,
      authMethod: request.authMethod ?? 'unknown',
      scopes,
      agentSessionId: grant?.sessionId,
      profileId: grant?.profileId,
    };

    const raw = request.raw ?? request;
    raw[McpAuthContextGuard.BRIDGE_KEY] = identity;
    // `user` is what `mcp-nest` reads off `raw` to filter the catalogue in `tools/list` and to refuse
    // a `tools/call`, comparing `user.scopes` against each tool's `@ToolScopes`. Writing the resolved
    // scopes here is therefore not bookkeeping: it is the whole enforcement of the tool allow-list,
    // and it has to be an object we build — the Mongo user document has no `scopes` field, so
    // forwarding it unchanged (as this line used to) meant every tool was reachable by everyone.
    raw.user = { ...(request.user ?? {}), scopes, email: identity.email, orgId: identity.orgId };

    this.logger.log(
      `[MCP_SESSION] actor=${identity.email || '-'} | org=${identity.orgId} | role=${identity.role ?? '-'} | auth=${identity.authMethod} | scopes=${scopes.join(',')}`,
    );
    return true;
  }
}

/**
 * The identity a tool is allowed to act on behalf of.
 *
 * Structurally a subset of `IRequestOrgContext` plus how the caller authenticated. It is a separate
 * interface rather than a re-export because it crosses a boundary: this is what survives the copy
 * onto the raw request, and anything a tool needs has to be listed here explicitly.
 */
export interface IMcpAuthContext {
  orgId: string;
  userId: string | null;
  email: string;
  role: string | null;
  permissions: string[];
  isPlatformAdmin: boolean;
  isPersonalSpace: boolean;
  authMethod: string;
  /** What this caller may do. Full vocabulary for a human; the grant's subset for an agent session. */
  scopes: McpScope[];
  /** Set only for an ephemeral agent token: the ACP bridge session that owns this credential. */
  agentSessionId?: string;
  /** Set only for an ephemeral agent token: the agentic profile the session belongs to. Audit only. */
  profileId?: string;
}
