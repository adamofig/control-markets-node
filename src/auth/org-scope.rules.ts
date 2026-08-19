import { IRequestOrgContext } from './org-context.service';
import { ISharedCatalogRule } from './shared-catalog';

/**
 * F14a's scoping table, as pure functions — **one rulebook, two consumers.**
 *
 * These rules were born inside `OrgScopeInterceptor`, which keys on `EntityController` subclasses.
 * That was right while REST was the only way to send a Mongo operation. It stopped being right when
 * the MCP server started exposing `tasks_operation`, `social_operation`, `org_operation` and
 * `users_operation` — the same arbitrary `{ action, query, payload }` shape, reaching the same
 * collections, through a transport the interceptor structurally cannot see (a tool is not a
 * controller).
 *
 * Copying the table into the MCP layer would have recreated the disease this codebase keeps curing:
 * N places to forget the filter. So the table moved here and both callers bind their own logging and
 * rollout policy to it. A rule fixed here is fixed for every transport at once.
 *
 * Nothing about the decisions changed in the move — the four-row table below is the one documented
 * on `OrgScopeInterceptor`, verbatim in behavior:
 *
 * | action | scoped by | why not the other one |
 * |---|---|---|
 * | `find`, `findOne`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany` | `query.orgId` | `payload` is a Mongo update document; a bare `orgId` next to `$set` is a path conflict error |
 * | `create` | `payload.orgId` | there is no query — the document is being born |
 * | `clone` | `payload.orgId` (the overrides) | the clone must land in *my* org |
 * | `aggregate` | a `$match` **prepended** to the pipeline | the pipeline is arbitrary; the only safe place is before its first stage |
 */

/** Actions whose `query` is a filter, and therefore the thing that decides which rows are touched. */
export const FILTER_ACTIONS = new Set(['find', 'findOne', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany']);
/** Actions whose `payload` is the document being written, so the org is stamped rather than filtered. */
export const CREATE_ACTIONS = new Set(['create', 'clone']);
/** Actions whose `payload` is a Mongo update document — strip a foreign org, never write ours in. */
export const UPDATE_ACTIONS = new Set(['updateOne', 'updateMany', 'partialUpdate']);
/** The subset of `FILTER_ACTIONS` that only reads, and is therefore what a shared catalog widens. */
export const READ_ACTIONS = new Set(['find', 'findOne']);

/** Called when the caller asserted an organization other than the resolved one. */
export type OrgScopeReporter = (where: string, claimed: unknown) => void;

export interface OrgScopeOptions {
  /**
   * Report what would have been rewritten, without rewriting it.
   *
   * A rollout knob for traffic that already exists — never a default. The MCP transport binds this
   * to `false` on purpose: its scoping ships enforced from the first request, so there is no
   * legacy behavior to phase out and no window in which an unscoped tool call looks normal.
   */
  logOnly?: boolean;
  /** Collections that are org-owned for writing but partly shared for reading (`agent_cards`). */
  shared?: ISharedCatalogRule;
  /**
   * The field that links a document to an organization. `orgId` for every collection REST scopes.
   *
   * Two collections do not follow that shape and are only reachable from MCP: `users` links through
   * `organizations[].orgId` (a person belongs to many orgs), and `organizations` *is* the org, so its
   * link is its own `id`. Writing `orgId` into either filter would be a silent no-op — a filter that
   * matches nothing, or worse, one that matches everything.
   */
  orgField?: string;
}

/** The filter the server is willing to run: `{ orgId }`, or the union when the collection is a catalog. */
export function readScope(ctx: IRequestOrgContext, shared?: ISharedCatalogRule, orgField = 'orgId'): Record<string, any> {
  if (!shared) return { [orgField]: ctx.orgId };
  return { $or: [{ [orgField]: ctx.orgId }, ...shared.sharedFilters] };
}

/**
 * Replaces whatever the caller asked for with the scope the server resolved.
 *
 * Without `shared` this overwrites `orgId` in place. With it, a foreign `orgId` is **removed** rather
 * than overwritten and the caller's remaining filter is `$and`-ed under the union — the caller can
 * still narrow, it just cannot widen past the union.
 */
export function scopeFilter(target: any, ctx: IRequestOrgContext, report: OrgScopeReporter, where: string, options: OrgScopeOptions = {}): any {
  const orgField = options.orgField ?? 'orgId';
  const filter = target && typeof target === 'object' && !Array.isArray(target) ? target : {};
  if (filter[orgField] !== undefined && filter[orgField] !== ctx.orgId) {
    report(where, filter[orgField]);
  }
  if (options.logOnly) return target;

  if (!options.shared) {
    filter[orgField] = ctx.orgId;
    return filter;
  }

  if (filter[orgField] !== undefined && filter[orgField] !== ctx.orgId) {
    delete filter[orgField];
  }
  const scope = readScope(ctx, options.shared, orgField);
  return Object.keys(filter).length > 0 ? { $and: [scope, filter] } : scope;
}

/** Stamps the org on a document being written. */
export function stampOrgId(document: any, ctx: IRequestOrgContext, report: OrgScopeReporter, where: string, options: OrgScopeOptions = {}): void {
  if (document.orgId !== undefined && document.orgId !== ctx.orgId) {
    report(where, document.orgId);
  }
  if (options.logOnly) return;
  document.orgId = ctx.orgId;
}

/**
 * Removes a foreign `orgId` from an update document instead of replacing it. Replacing would rewrite
 * the row's owner — turning a filter into a takeover primitive; the accompanying query already
 * limits the write to our organization.
 */
export function stripForeignOrgId(payload: any, ctx: IRequestOrgContext, report: OrgScopeReporter, where: string, options: OrgScopeOptions = {}): void {
  if (!payload || typeof payload !== 'object') return;

  for (const container of [payload, payload.$set, payload.$setOnInsert]) {
    if (!container || typeof container !== 'object') continue;
    if (container.orgId !== undefined && container.orgId !== ctx.orgId) {
      report(where, container.orgId);
      if (!options.logOnly) delete container.orgId;
    }
  }
}

/** True when the caller is a platform admin asking explicitly for the cross-org escape hatch. */
export function isAdminBypass(operation: any, ctx: IRequestOrgContext): boolean {
  return !!ctx.isPlatformAdmin && operation?.options?.adminBypass === true;
}

/**
 * Rewrites one `{ action, query, payload, options }` operation so it can only touch the caller's
 * organization. Mutates in place, which is what both call sites need: the interceptor rewrites the
 * request body before the controller reads it, and the MCP tool rewrites its arguments before the
 * service does.
 *
 * The platform-admin escape hatch survives here on purpose and is audited every time — the caller
 * decides what "audited" means by what it does in `report`.
 */
export function scopeOperation(
  operation: any,
  ctx: IRequestOrgContext,
  report: OrgScopeReporter,
  options: OrgScopeOptions = {},
): void {
  if (!operation || typeof operation !== 'object') return;
  if (isAdminBypass(operation, ctx)) return;

  const action = operation.action;

  if (action === 'aggregate') {
    // An arbitrary pipeline can read anything in the collection, so the scope goes in front of its
    // first stage where nothing can have widened it yet. A later `$match` can only narrow it.
    const pipeline = Array.isArray(operation.payload) ? operation.payload : [];
    operation.payload = [{ $match: readScope(ctx, options.shared, options.orgField) }, ...pipeline];
    return;
  }

  if (FILTER_ACTIONS.has(action)) {
    const readOnly = READ_ACTIONS.has(action);
    operation.query = scopeFilter(operation.query, ctx, report, `operation(${action}).query`, {
      ...options,
      shared: readOnly ? options.shared : undefined,
    });
  }
  if (CREATE_ACTIONS.has(action)) {
    operation.payload = operation.payload ?? {};
    stampOrgId(operation.payload, ctx, report, `operation(${action}).payload`, options);
  }
  if (UPDATE_ACTIONS.has(action)) {
    stripForeignOrgId(operation.payload, ctx, report, `operation(${action}).payload`, options);
  }
}
