import { CallHandler, ExecutionContext, ForbiddenException, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { EntityController, EntityMongoController } from '@dataclouder/nest-mongo';
import { IS_PUBLIC_KEY } from './public.decorator';
import { IS_NOT_ORG_SCOPED_KEY } from './not-org-scoped.decorator';
import { IRequestOrgContext } from './org-context.service';

/**
 * F14a — **the `orgId` belongs to the server.**
 *
 * F12 answers *"may you do this?"*. It does not answer *"on whose data?"* — today that second question is
 * answered by the client, which sends `orgId` inside the request body. A caller who is a legitimate Member
 * of org A can put `orgId: B` in the payload and the query runs against B. That is the confused deputy the
 * whole Block C exists to close, and no guard can close it: the guard sees a permitted verb.
 *
 * `EntityController` and `EntityMongoController` live in `@dataclouder/nest-mongo`, so there is no `if` to
 * add inside them. This interceptor rewrites the payload on the way in instead, before the controller ever
 * sees it. The rule it enforces has one sentence:
 *
 * > The client may **ask** for an organization (the `x-org-id` header, validated against Mongo by
 * > `OrgContextGuard`). It may never **assert** one (the body). A body `orgId` that disagrees with the
 * > resolved context is discarded and logged as an attempt.
 *
 * ## Why it rewrites per action instead of blanket-setting `orgId`
 *
 * The DTO field that scopes a request depends on the verb, and getting this wrong is not a no-op:
 *
 * | action | scoped by | why not the other one |
 * |---|---|---|
 * | `find`, `findOne`, `updateOne`, `updateMany`, `deleteOne` | `query.orgId` | `payload` is a Mongo update document; adding a bare `orgId` next to `$set` is a path conflict error |
 * | `create` | `payload.orgId` | there is no query — the document is being born |
 * | `clone` | `payload.orgId` (the overrides) | the clone must land in *my* org |
 * | `aggregate` | a `$match` **prepended** to the pipeline | the pipeline is arbitrary; the only safe place is before its first stage |
 *
 * On update-shaped actions a client-supplied `orgId` is **stripped, never overwritten**: writing our own
 * value into the update document would let `updateOne` move somebody else's row into our organization —
 * turning a filter into a takeover primitive. The `query` already restricts the write to our org, so the
 * strip is enough.
 *
 * ## What this interceptor structurally cannot close
 *
 * Routes addressed by id carry no filter to rewrite: `GET /:id`, `PUT /:id`, and the `partialUpdate` /
 * `clone` actions, which read `query.id` and ignore the rest. For the two read paths (`GET /:id`,
 * `GET /`) it checks the **response** instead and drops or refuses documents belonging to another
 * organization — a document with no `orgId` at all is not org-scoped and passes untouched.
 *
 * `PUT /:id` and `partialUpdate` remain open: refusing them needs the document to be read before the
 * write, which an interceptor cannot do without the model. They are written down in doc 06 §F14a rather
 * than left for someone to discover.
 */
@Injectable()
export class OrgScopeInterceptor implements NestInterceptor {
  private readonly logger = new Logger('OrgScopeInterceptor');

  /** Actions whose `query` is a filter, and therefore the thing that decides which rows are touched. */
  private static readonly FILTER_ACTIONS = new Set(['find', 'findOne', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany']);
  /** Actions whose `payload` is the document being written, so the org is stamped rather than filtered. */
  private static readonly CREATE_ACTIONS = new Set(['create', 'clone']);
  /** Actions whose `payload` is a Mongo update document — strip a foreign org, never write ours in. */
  private static readonly UPDATE_ACTIONS = new Set(['updateOne', 'updateMany', 'partialUpdate']);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const controller = context.getClass();
    const isEntityController = controller.prototype instanceof EntityController || controller.prototype instanceof EntityMongoController;
    if (!isEntityController) {
      return next.handle();
    }

    const exempt = this.reflector.getAllAndOverride<boolean>(IS_NOT_ORG_SCOPED_KEY, [context.getHandler(), controller]);
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), controller]);
    if (exempt || isPublic) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const ctx: IRequestOrgContext | undefined = request.ctx;
    if (!ctx?.orgId) {
      // No resolved organization means `OrgContextGuard` either let an account-scoped route through or
      // could not resolve one. There is nothing to scope *to*, and inventing a value would be worse than
      // leaving the request as it came.
      return next.handle();
    }

    const handler = context.getHandler().name;
    this.scopeRequest(handler, request, ctx);

    if (handler === 'findAll' || handler === 'findOne') {
      return next.handle().pipe(map(response => this.scopeResponse(handler, response, ctx, request)));
    }
    return next.handle();
  }

  private scopeRequest(handler: string, request: any, ctx: IRequestOrgContext): void {
    const body = request.body;

    switch (handler) {
      case 'executeOperation':
        this.scopeOperation(body, ctx, request);
        break;
      case 'executeBatch':
        for (const operation of body?.operations ?? []) {
          this.scopeOperation(operation, ctx, request);
        }
        break;
      case 'query':
        // `FiltersConfig.filters` is what `queryUsingFiltersConfig` turns into the Mongo filter.
        if (body) {
          body.filters = this.forceOrgId(body.filters, ctx, request, 'query.filters');
        }
        break;
      case 'findOneByQuery':
        if (body) {
          body.query = this.forceOrgId(body.query, ctx, request, 'find-one.query');
        }
        break;
      case 'save':
        if (body && typeof body === 'object') {
          this.stampOrgId(body, ctx, request, 'save.body');
        }
        break;
      case 'partialUpdate':
        // Id-addressed: there is no filter to force. All we can do is refuse to let the update move the
        // document into another organization.
        this.stripForeignOrgId(body, ctx, request, 'partialUpdate.body');
        break;
      default:
        break;
    }
  }

  private scopeOperation(operation: any, ctx: IRequestOrgContext, request: any): void {
    if (!operation || typeof operation !== 'object') return;

    // The platform-admin escape hatch that `/page/admin/admin-entities` uses to list across organizations.
    // It survives F14a on purpose, and it is audited every time — same rule as `[ADMIN_BYPASS]` elsewhere.
    if (ctx.isPlatformAdmin && operation.options?.adminBypass === true) {
      this.logger.warn(`[ADMIN_BYPASS] ${request.method} ${request.url} | actor=${ctx.email} | action=${operation.action} | org scope not applied`);
      return;
    }

    const action = operation.action;

    if (action === 'aggregate') {
      // An arbitrary pipeline can read anything in the collection, so the scope goes in front of its first
      // stage where nothing can have widened it yet.
      const pipeline = Array.isArray(operation.payload) ? operation.payload : [];
      operation.payload = [{ $match: { orgId: ctx.orgId } }, ...pipeline];
      return;
    }

    if (OrgScopeInterceptor.FILTER_ACTIONS.has(action)) {
      operation.query = this.forceOrgId(operation.query, ctx, request, `operation(${action}).query`);
    }
    if (OrgScopeInterceptor.CREATE_ACTIONS.has(action)) {
      operation.payload = operation.payload ?? {};
      this.stampOrgId(operation.payload, ctx, request, `operation(${action}).payload`);
    }
    if (OrgScopeInterceptor.UPDATE_ACTIONS.has(action)) {
      this.stripForeignOrgId(operation.payload, ctx, request, `operation(${action}).payload`);
    }
  }

  /** Overwrites the filter's `orgId` with the resolved one, whatever the client sent. */
  private forceOrgId(target: any, ctx: IRequestOrgContext, request: any, where: string): any {
    const filter = target && typeof target === 'object' && !Array.isArray(target) ? target : {};
    if (filter.orgId !== undefined && filter.orgId !== ctx.orgId) {
      this.report(request, ctx, where, filter.orgId);
    }
    if (this.isLogOnly()) return target;
    filter.orgId = ctx.orgId;
    return filter;
  }

  /** Stamps the org on a document being written. */
  private stampOrgId(document: any, ctx: IRequestOrgContext, request: any, where: string): void {
    if (document.orgId !== undefined && document.orgId !== ctx.orgId) {
      this.report(request, ctx, where, document.orgId);
    }
    if (this.isLogOnly()) return;
    document.orgId = ctx.orgId;
  }

  /**
   * Removes a foreign `orgId` from an update document instead of replacing it. Replacing would rewrite the
   * row's owner; the accompanying query already limits the write to our organization.
   */
  private stripForeignOrgId(payload: any, ctx: IRequestOrgContext, request: any, where: string): void {
    if (!payload || typeof payload !== 'object') return;

    for (const container of [payload, payload.$set, payload.$setOnInsert]) {
      if (!container || typeof container !== 'object') continue;
      if (container.orgId !== undefined && container.orgId !== ctx.orgId) {
        this.report(request, ctx, where, container.orgId);
        if (!this.isLogOnly()) delete container.orgId;
      }
    }
  }

  /**
   * The two id-addressed reads. A document without an `orgId` is not org-scoped (leads, and anything the
   * exemption list would have covered anyway) and is returned untouched.
   */
  private scopeResponse(handler: string, response: any, ctx: IRequestOrgContext, request: any): any {
    if (ctx.isPlatformAdmin) return response;

    if (handler === 'findAll' && Array.isArray(response)) {
      const kept = response.filter(row => row?.orgId === undefined || row.orgId === ctx.orgId);
      if (kept.length !== response.length) {
        this.logger.warn(`[ORG_SCOPE_RESPONSE] ${request.method} ${request.url} | actor=${ctx.email} | dropped ${response.length - kept.length} rows outside org ${ctx.orgId}`);
      }
      return this.isLogOnly() ? response : kept;
    }

    if (handler === 'findOne' && response && typeof response === 'object') {
      const orgId = (response as any).orgId;
      if (orgId !== undefined && orgId !== ctx.orgId) {
        this.report(request, ctx, 'response(findOne)', orgId);
        if (!this.isLogOnly()) {
          throw new ForbiddenException(`This document belongs to another organization.`);
        }
      }
    }

    return response;
  }

  /**
   * `SECURITY_ORG_SCOPE_LOG_ONLY=true` reports what would have been rewritten without rewriting it —
   * the same rollout step F12 has, and a separate switch on purpose: these are two different deploys and
   * one should not be able to silently turn off the other.
   */
  private isLogOnly(): boolean {
    return process.env.SECURITY_ORG_SCOPE_LOG_ONLY === 'true';
  }

  /**
   * A client asserting an organization other than the one the server resolved is either a bug in the
   * frontend (F14b has not removed the field yet) or someone probing another tenant. Both are worth a line;
   * neither is worth an error, because discarding the value already made the request safe.
   */
  private report(request: any, ctx: IRequestOrgContext, where: string, claimed: unknown): void {
    this.logger.warn(
      `[ORG_SCOPE_OVERRIDE] ${request.method} ${request.url} | actor=${ctx.email ?? '-'} | at=${where} | claimed=${String(claimed)} | resolved=${ctx.orgId}`
    );
  }
}
