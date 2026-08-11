import { applyDecorators, SetMetadata } from '@nestjs/common';

export const IS_ACCOUNT_SCOPED_KEY = 'cm:isAccountScoped';
export const ACCOUNT_SCOPED_REASON_KEY = 'cm:accountScopedReason';

/**
 * Marks a route as **authenticated but not org-scoped**: the caller must prove who they are, and is
 * exempt from F12's requirement of holding a membership in the target organization.
 *
 * It exists because the default-closed guard has a chicken-and-egg problem it cannot solve on its own.
 * `GET /api/init/user` is the endpoint that *creates* the account and its personal organization; a
 * first-time user reaching it has no `users` row, therefore no membership, therefore — without this
 * decorator — a 403 from the one endpoint that would have given them a membership. Registration
 * dead-ends and there is no request the client could send to recover.
 *
 * This is **not** a second `@Public()`. `ProjectAuthGuard` still runs: no token is still a 401. What
 * is waived is only the org membership check, and only for routes that act on the account rather
 * than on an organization's data.
 *
 * Keep the list short. If a route reads or writes anything belonging to an organization, it is not
 * account-scoped — it needs a membership, which is the entire point of F12.
 *
 * @param reason Why this route cannot require an organization membership.
 */
export const AccountScoped = (reason: string) =>
  applyDecorators(SetMetadata(IS_ACCOUNT_SCOPED_KEY, true), SetMetadata(ACCOUNT_SCOPED_REASON_KEY, reason));
