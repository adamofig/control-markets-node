import { AgentCardsController } from '@dataclouder/nest-agent-cards';

/**
 * F14a, second case — the collections that are **org-owned for writing but partly shared for reading**.
 *
 * `@NotOrgScoped` covers collections that have no `orgId` at all. This is the opposite shape: the rows do
 * carry an `orgId`, the write path must keep honouring it, and yet some of them are meant to be readable by
 * every organization. `agent_cards` is the first: the platform ships a catalog of narrators and characters
 * that any tenant can pick a voice from, while each tenant also keeps its own private cards.
 *
 * Forcing `orgId: ctx.orgId` on those reads is what makes the catalog disappear — the symptom is an empty
 * agent picker in Video Scenes and Canvas, which reads as a broken feature rather than a security rule.
 *
 * ## Why a registry keyed by class instead of a decorator
 *
 * `AgentCardsController` lives in `@dataclouder/nest-agent-cards`, so there is no source file to put a
 * decorator on — the same constraint that produced `OrgScopeInterceptor` in the first place. Listing the
 * class here keeps the exception in one reviewable place, and it is asserted in `route-guards.spec.ts` so
 * widening it stays a deliberate edit to a test.
 *
 * ## What it does *not* relax
 *
 * Only reads. `create`, `updateOne`, `updateMany`, `deleteOne` and `partialUpdate` keep the strict
 * `orgId: ctx.orgId` filter, so a shared card can be read and cloned by anyone but written by nobody except
 * its owner. Copying one into your own organization is the `clone` action, which already stamps your
 * `orgId` on the copy — that is the Fork flow, and it needs no exception.
 */
export interface ISharedCatalogRule {
  /** Why this collection is readable across organizations, and what still scopes its writes. */
  readonly reason: string;
  /**
   * Mongo filters, OR-ed with `{ orgId: ctx.orgId }`, matching the rows every organization may read.
   * Note `{ orgId: null }` matches a missing field too, which is what makes library-seeded cards visible.
   */
  readonly sharedFilters: readonly Record<string, any>[];
  /** The same rule applied to a document already in memory, for response scoping. */
  isShared(document: any): boolean;
}

export const SHARED_CATALOG_CONTROLLERS: ReadonlyMap<Function, ISharedCatalogRule> = new Map<Function, ISharedCatalogRule>([
  [
    AgentCardsController,
    {
      reason:
        'agent_cards is a shared catalog: cards flagged manageable.isPublic, and cards seeded by the library with no owner, are the stock voices and characters every organization picks from in Video Scenes and Canvas. Writes stay scoped to the owning org, so a public card can be read and forked but never edited from outside.',
      sharedFilters: [{ 'manageable.isPublic': true }, { orgId: null }],
      isShared: (document: any) => document?.manageable?.isPublic === true || document?.orgId == null,
    },
  ],
]);
