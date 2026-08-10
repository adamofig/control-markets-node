import { applyDecorators, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'cm:isPublic';
export const PUBLIC_REASON_KEY = 'cm:publicReason';

/**
 * Marks a route (or a whole controller) as reachable without credentials.
 *
 * `ProjectAuthGuard` reads this metadata and short-circuits before touching the token, so the
 * decorator works the same whether the guard is applied locally (F10) or globally (F12) — moving
 * it to `APP_GUARD` changes nothing here.
 *
 * The reason is a **required argument on purpose**: the F12 audit asks for a written justification
 * for every exception, and a justification that lives outside the code is a justification that
 * rots. If you cannot write why the endpoint is public, it is not public.
 *
 * @param reason Why this endpoint runs without authentication, and what would have to change to close it.
 */
export const Public = (reason: string) => applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), SetMetadata(PUBLIC_REASON_KEY, reason));
