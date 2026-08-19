/**
 * What a credential is allowed to *do* over MCP, as opposed to *where* it may do it.
 *
 * `mcp-scope.util.ts` answers the second question — which organization a call lands in — and it
 * answers it for every caller alike. This file answers the first one, and it exists because task 25
 * connects `/mcp` to sessions that no human is watching: an autonomous wake-up by cron gets the same
 * tool catalogue a person gets from their terminal, and "read the wiki" and "update a user by email"
 * are not the same request even when both are correctly scoped to one tenant.
 *
 * ## Why scopes and not a list of tool names on the token
 *
 * A name list would be enforced in one place — the call — and would say nothing at `tools/list`.
 * `@rekog/mcp-nest` already filters the catalogue by `requiredScopes` against `raw.user.scopes`
 * (`mcp-tools.handler.ts`, both on `tools/list` and on `tools/call`), so declaring the scope on the
 * tool gets **both** enforcement points from the library, and the catalogue a restricted token sees
 * shrinks instead of merely failing late.
 *
 * That second half is not cosmetic. Measured on `agy` 2026-08-18, the tool catalogue is injected
 * into the system prompt of *every* turn: two MCP servers (~14 tools) cost ~890 input tokens per
 * turn. Tools a session may not call are pure recurring cost.
 *
 * ## The vocabulary is coarse on purpose
 *
 * One scope per tool family, not per tool. Finer granularity is [task 27]'s job — there a skill
 * grants a capability and the grant decides the tool set. Until then, a per-tool vocabulary would be
 * thirty strings nobody could hold in their head, invented before the thing that consumes them.
 */

export const MCP_SCOPES = {
  /** `cm://` reads: documents, skills, tasks-as-text, another agent's compiled context. */
  resources: 'cm:resources',
  /** Agent tasks and outcome jobs — read and write. */
  tasks: 'cm:tasks',
  /** Canvas flows: inspect, add nodes, execute. */
  flows: 'cm:flows',
  /** Social posts and their calendar. */
  social: 'cm:social',
  /** Organization documents and membership. */
  org: 'cm:org',
  /** The users collection. */
  users: 'cm:users',
  /** Outbound messages to a human (Telegram, inbox). */
  messaging: 'cm:messaging',
} as const;

export type McpScope = (typeof MCP_SCOPES)[keyof typeof MCP_SCOPES];

/** Everything. What a human's PAT, a Firebase session or the master token get. */
export const ALL_MCP_SCOPES: McpScope[] = Object.values(MCP_SCOPES);

/**
 * What an ACP session gets by default when the bridge mints its ephemeral token.
 *
 * Reading knowledge and working its own tasks is the whole point of task 25; publishing to social
 * media, messaging humans or touching the users collection is not something an unattended cron run
 * should be able to reach because it happened to be given a chat window. Widen it deliberately with
 * `AGENT_SESSION_MCP_SCOPES` (comma-separated) when a profile genuinely needs more.
 */
export const DEFAULT_AGENT_SESSION_SCOPES: McpScope[] = [MCP_SCOPES.resources, MCP_SCOPES.tasks];

/** Parses `AGENT_SESSION_MCP_SCOPES`, ignoring anything outside the vocabulary above. */
export function resolveAgentSessionScopes(raw = process.env.AGENT_SESSION_MCP_SCOPES): McpScope[] {
  const configured = (raw ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (!configured.length) return DEFAULT_AGENT_SESSION_SCOPES;
  const known = configured.filter((value): value is McpScope => (ALL_MCP_SCOPES as string[]).includes(value));
  // An empty result would silently mean "no tools at all", which is a worse outcome than the
  // default for what is almost certainly a typo in an env var.
  return known.length ? known : DEFAULT_AGENT_SESSION_SCOPES;
}

/**
 * The tools a scope set can reach, by name.
 *
 * Duplicated knowledge — the authority is the `@ToolScopes` decorator on each tool — and duplicated
 * on purpose: the context index rendered by task 23 has to name the tools a session will have
 * *before* the session exists, so it cannot ask a running MCP server. `mcp-tool-scope.spec.ts`
 * asserts this table against the decorators, so the copy cannot drift unnoticed.
 */
export const MCP_TOOLS_BY_SCOPE: Record<McpScope, string[]> = {
  [MCP_SCOPES.resources]: ['cm_read', 'agentic_profile_get_context'],
  [MCP_SCOPES.tasks]: ['tasks_operation', 'tasks_getSchema', 'tasks_getByAssignee', 'tasks_executeTask', 'tasks_updateSubtaskStatus', 'tasks_jobsOperation'],
  [MCP_SCOPES.flows]: ['flow_listFlows', 'flow_getFlow', 'flow_addNodes', 'flow_moveNodes', 'flow_runNode', 'flow_runFlow', 'flow_runAndWait'],
  [MCP_SCOPES.social]: ['social_operation', 'social_listPosts', 'social_getPost', 'social_createPost', 'social_updatePost', 'social_getPostsThisWeek'],
  [MCP_SCOPES.org]: ['org_operation', 'org_findByUser', 'org_getMembers', 'org_operateUser'],
  [MCP_SCOPES.users]: ['users_operation', 'users_findByEmail', 'users_findById', 'users_updateByEmail'],
  [MCP_SCOPES.messaging]: ['messaging_notifyUser'],
};

/** Tool names reachable with a given scope set, in a stable order. */
export function toolNamesForScopes(scopes: readonly McpScope[]): string[] {
  return scopes.flatMap(scope => MCP_TOOLS_BY_SCOPE[scope] ?? []);
}
