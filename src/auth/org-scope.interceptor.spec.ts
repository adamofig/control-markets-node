import { ForbiddenException } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { EntityController, EntityMongoController } from '@dataclouder/nest-mongo';
import { AgentCardsController } from '@dataclouder/nest-agent-cards';
import { OrgScopeInterceptor } from './org-scope.interceptor';
import { IS_NOT_ORG_SCOPED_KEY } from './not-org-scoped.decorator';
import { IRequestOrgContext } from './org-context.service';

/**
 * F14a — the three isolation tests doc 04 §12 asks for, written against the piece that enforces them:
 * a member of org A asking for org B by header, by body and by query must fail all three.
 */
describe('OrgScopeInterceptor (F14a)', () => {
  const ORG_A = 'org-a';
  const ORG_B = 'org-b';

  class ScopedController extends EntityMongoController<any> {}
  class FullController extends EntityController<any> {}
  class PlainController {}

  function ctxFor(overrides: Partial<IRequestOrgContext> = {}): IRequestOrgContext {
    return { userId: 'u1', email: 'member@cm.com', orgId: ORG_A, role: null, permissions: [], isPlatformAdmin: false, isPersonalSpace: false, ...overrides };
  }

  function run(
    { controller = ScopedController as any, handler = 'executeOperation', body = {}, ctx = ctxFor(), metadata = {}, response = undefined as any } = {}
  ) {
    const request: any = { body, ctx, method: 'POST', url: '/api/agent-tasks/operation' };
    const reflector = { getAllAndOverride: jest.fn((key: string) => metadata[key]) } as any;
    const interceptor = new OrgScopeInterceptor(reflector);
    const execution: any = {
      getType: () => 'http',
      getClass: () => controller,
      getHandler: () => ({ name: handler }),
      switchToHttp: () => ({ getRequest: () => request }),
    };
    const next = { handle: () => of(response) };
    return { request, result: interceptor.intercept(execution, next) };
  }

  describe('the client can ask for an organization, never assert one', () => {
    it('overwrites a body orgId that disagrees with the resolved context', async () => {
      const { request } = run({ body: { action: 'find', query: { orgId: ORG_B, status: 'open' } } });

      expect(request.body.query).toEqual({ orgId: ORG_A, status: 'open' });
    });

    it('adds the scope when the client sent no orgId at all — this is what F14b relies on', async () => {
      const { request } = run({ body: { action: 'find', query: { status: 'open' } } });

      expect(request.body.query.orgId).toBe(ORG_A);
    });

    it('creates the query when the operation carries none', async () => {
      const { request } = run({ body: { action: 'deleteOne' } });

      expect(request.body.query).toEqual({ orgId: ORG_A });
    });

    it('stamps the org on a create instead of filtering by it', async () => {
      const { request } = run({ body: { action: 'create', payload: { title: 'x', orgId: ORG_B } } });

      expect(request.body.payload.orgId).toBe(ORG_A);
    });

    it('scopes every operation of a batch', async () => {
      const { request } = run({
        handler: 'executeBatch',
        body: { operations: [{ action: 'find', query: { orgId: ORG_B } }, { action: 'create', payload: { orgId: ORG_B } }] },
      });

      expect(request.body.operations[0].query.orgId).toBe(ORG_A);
      expect(request.body.operations[1].payload.orgId).toBe(ORG_A);
    });

    it('scopes POST /query through FiltersConfig.filters', async () => {
      const { request } = run({ handler: 'query', body: { filters: { orgId: ORG_B }, page: 1 } });

      expect(request.body.filters.orgId).toBe(ORG_A);
    });

    it('scopes POST /find-one', async () => {
      const { request } = run({ handler: 'findOneByQuery', body: { query: { id: 'abc' } } });

      expect(request.body.query.orgId).toBe(ORG_A);
    });

    it('stamps the org on POST / (save)', async () => {
      const { request } = run({ controller: FullController, handler: 'save', body: { name: 'n', orgId: ORG_B } });

      expect(request.body.orgId).toBe(ORG_A);
    });
  });

  describe('update documents are stripped, not rewritten', () => {
    /**
     * The distinction is the whole point: writing our orgId into an update document would turn
     * `updateOne` into a way to move somebody else's row into our organization. The query already
     * restricts which rows are touched.
     */
    it('removes a foreign orgId from the update instead of setting ours', async () => {
      const { request } = run({ body: { action: 'updateOne', query: {}, payload: { $set: { orgId: ORG_B, title: 'x' } } } });

      expect(request.body.payload.$set).toEqual({ title: 'x' });
      expect(request.body.query.orgId).toBe(ORG_A);
    });

    it('leaves an update alone when its orgId already matches', async () => {
      const { request } = run({ body: { action: 'updateOne', query: {}, payload: { orgId: ORG_A, title: 'x' } } });

      expect(request.body.payload).toEqual({ orgId: ORG_A, title: 'x' });
    });
  });

  describe('aggregate', () => {
    it('prepends a $match so the pipeline cannot start wider than the organization', async () => {
      const { request } = run({ body: { action: 'aggregate', payload: [{ $match: { orgId: ORG_B } }, { $count: 'total' }] } });

      expect(request.body.payload[0]).toEqual({ $match: { orgId: ORG_A } });
      expect(request.body.payload).toHaveLength(3);
    });
  });

  describe('what it must not touch', () => {
    it('ignores controllers that are not entity controllers', async () => {
      const { request } = run({ controller: PlainController, body: { action: 'find', query: { orgId: ORG_B } } });

      expect(request.body.query.orgId).toBe(ORG_B);
    });

    it('ignores a controller marked @NotOrgScoped — its collection has no orgId to filter by', async () => {
      const { request } = run({ metadata: { [IS_NOT_ORG_SCOPED_KEY]: true }, body: { action: 'find', query: {} } });

      expect(request.body.query.orgId).toBeUndefined();
    });

    it('does nothing when no organization could be resolved', async () => {
      const { request } = run({ ctx: ctxFor({ orgId: null }), body: { action: 'find', query: {} } });

      expect(request.body.query.orgId).toBeUndefined();
    });

    it('preserves the platform-admin adminBypass that the cross-org admin screen depends on', async () => {
      const { request } = run({
        ctx: ctxFor({ isPlatformAdmin: true }),
        body: { action: 'find', query: {}, options: { adminBypass: true } },
      });

      expect(request.body.query.orgId).toBeUndefined();
    });

    it('does NOT honour adminBypass for someone who is not a platform admin', async () => {
      const { request } = run({ body: { action: 'find', query: {}, options: { adminBypass: true } } });

      expect(request.body.query.orgId).toBe(ORG_A);
    });
  });

  describe('the id-addressed reads, which have no filter to rewrite', () => {
    it('refuses a GET /:id that resolved to another organization', async () => {
      const { result } = run({ controller: FullController, handler: 'findOne', response: { id: 'x', orgId: ORG_B } });

      await expect(firstValueFrom(result)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns a document of my own organization', async () => {
      const { result } = run({ controller: FullController, handler: 'findOne', response: { id: 'x', orgId: ORG_A } });

      await expect(firstValueFrom(result)).resolves.toEqual({ id: 'x', orgId: ORG_A });
    });

    it('passes through a document that carries no orgId — it is not org-scoped', async () => {
      const { result } = run({ controller: FullController, handler: 'findOne', response: { id: 'x' } });

      await expect(firstValueFrom(result)).resolves.toEqual({ id: 'x' });
    });

    it('drops the rows of other organizations from GET /', async () => {
      const { result } = run({
        controller: FullController,
        handler: 'findAll',
        response: [{ id: '1', orgId: ORG_A }, { id: '2', orgId: ORG_B }, { id: '3' }],
      });

      await expect(firstValueFrom(result)).resolves.toEqual([{ id: '1', orgId: ORG_A }, { id: '3' }]);
    });
  });

  /**
   * The shared-catalog half of F14a. `agent_cards` is the collection it exists for: the stock voices and
   * characters have to reach every organization's agent picker, while staying unwritable from outside.
   */
  describe('shared catalogs (agent_cards)', () => {
    it('reads the union of my organization and the shared rows instead of my organization alone', async () => {
      const { request } = run({ controller: AgentCardsController, body: { action: 'find', query: {} } });

      expect(request.body.query).toEqual({ $or: [{ orgId: ORG_A }, { 'manageable.isPublic': true }, { orgId: null }] });
    });

    it('keeps the rest of the client filter under the union so the UI filters still narrow', async () => {
      const { request } = run({ controller: AgentCardsController, body: { action: 'find', query: { 'manageable.isPublic': true } } });

      expect(request.body.query).toEqual({
        $and: [{ $or: [{ orgId: ORG_A }, { 'manageable.isPublic': true }, { orgId: null }] }, { 'manageable.isPublic': true }],
      });
    });

    it('still refuses a client that asserts another organization', async () => {
      const { request } = run({ controller: AgentCardsController, body: { action: 'find', query: { orgId: ORG_B } } });

      expect(request.body.query).toEqual({ $or: [{ orgId: ORG_A }, { 'manageable.isPublic': true }, { orgId: null }] });
    });

    it('prepends the union to an aggregate, which is what the list page runs', async () => {
      const { request } = run({ controller: AgentCardsController, body: { action: 'aggregate', payload: [{ $limit: 20 }] } });

      expect(request.body.payload[0]).toEqual({ $match: { $or: [{ orgId: ORG_A }, { 'manageable.isPublic': true }, { orgId: null }] } });
    });

    it('does NOT widen a write — a public card of another org stays unwritable', async () => {
      const { request } = run({ controller: AgentCardsController, body: { action: 'updateOne', query: { _id: 'card-1' }, payload: { $set: { name: 'x' } } } });

      expect(request.body.query).toEqual({ _id: 'card-1', orgId: ORG_A });
    });

    it('does NOT widen a delete either', async () => {
      const { request } = run({ controller: AgentCardsController, body: { action: 'deleteOne', query: { _id: 'card-1' } } });

      expect(request.body.query).toEqual({ _id: 'card-1', orgId: ORG_A });
    });

    it('stamps my organization on a clone, which is the Fork flow', async () => {
      const { request } = run({ controller: AgentCardsController, body: { action: 'clone', query: { _id: 'card-1' }, payload: {} } });

      expect(request.body.payload.orgId).toBe(ORG_A);
    });
  });

  describe('log-only rollout', () => {
    afterEach(() => {
      delete process.env.SECURITY_ORG_SCOPE_LOG_ONLY;
    });

    it('leaves the payload exactly as it came while the switch is on', async () => {
      process.env.SECURITY_ORG_SCOPE_LOG_ONLY = 'true';
      const { request } = run({ body: { action: 'find', query: { orgId: ORG_B } } });

      expect(request.body.query.orgId).toBe(ORG_B);
    });

    it('does not drop rows from the response either', async () => {
      process.env.SECURITY_ORG_SCOPE_LOG_ONLY = 'true';
      const { result } = run({ controller: FullController, handler: 'findAll', response: [{ id: '2', orgId: ORG_B }] });

      await expect(firstValueFrom(result)).resolves.toEqual([{ id: '2', orgId: ORG_B }]);
    });
  });
});
