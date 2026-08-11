import { applyDecorators, SetMetadata } from '@nestjs/common';

export const IS_NOT_ORG_SCOPED_KEY = 'cm:isNotOrgScoped';
export const NOT_ORG_SCOPED_REASON_KEY = 'cm:notOrgScopedReason';

/**
 * Marks a controller (or one route) whose collection is **not** keyed by `orgId`, so `OrgScopeInterceptor`
 * must leave its payloads alone.
 *
 * F14a forces `orgId` into every entity query and payload, which is right for the ~17 collections that
 * carry the field and wrong for the ones that do not: `users` is scoped by `organizations[].orgId`,
 * `organizations` by its own `_id`, and `leads` / `deck_commander` are not multi-tenant at all. Filtering
 * those by a field they never store returns zero rows — a whole screen that silently goes blank, which is
 * the failure mode a security change can least afford, because it looks like a bug in the feature.
 *
 * The exemption is per controller and its list is fixed in `route-guards.spec.ts`: adding one has to be an
 * edit to a test, not a decorator that slips through review. Everything else is scoped by default — that
 * is the whole point, and it is what makes a new entity born safe.
 *
 * @param reason Why this collection cannot be filtered by `orgId`, and what scopes it instead.
 */
export const NotOrgScoped = (reason: string) =>
  applyDecorators(SetMetadata(IS_NOT_ORG_SCOPED_KEY, true), SetMetadata(NOT_ORG_SCOPED_REASON_KEY, reason));
