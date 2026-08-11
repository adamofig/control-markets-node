import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { AuthContextController } from './auth-context.controller';
import { OrganizationModule } from 'src/organization/organization.module';
import { OrgContextService } from './org-context.service';
import { OrgContextGuard } from './org-context.guard';
import { ProjectAuthGuard } from 'src/user/project-auth.guard';
import { OrgScopeInterceptor } from './org-scope.interceptor';

/**
 * Org-scoped authorization: the role→permission matrix, the context endpoint the frontend reads,
 * and the guard that enforces `@OrgPermission`. `AppUserService` comes from the global `UserModule`.
 *
 * `@Global()` (F11): `OrgContextGuard` is also mounted from other modules' controllers, so exporting
 * it avoids making each of those modules import this one — which would cycle with `OrganizationModule`.
 *
 * ## F12 — the two global guards are registered here, in this order, on purpose
 *
 * Nest applies `APP_GUARD` enhancers in the order the providers are scanned, and across modules that
 * order is the shape of the import graph in `app.module.ts` — not something this file controls.
 * `OrgContextGuard` reads `request.decodedToken`, which only exists once `ProjectAuthGuard` has run;
 * if the order ever flipped, every `req.ctx` would resolve anonymously, which fails **open** on the
 * default-closed branch (no `decodedToken` → no deny) and denies every `@OrgPermission` route.
 * Two entries in one `providers` array is the only registration whose order is guaranteed.
 *
 * `useExisting` and not `useClass`: `ProjectAuthGuard` is already a provider of the global `UserModule`,
 * and a second instance would mean a second Firebase verification / Mongo lookup per request.
 */
@Global()
@Module({
  imports: [NestAuthModule, OrganizationModule],
  controllers: [AuthContextController],
  providers: [
    OrgContextService,
    OrgContextGuard,
    { provide: APP_GUARD, useExisting: ProjectAuthGuard },
    { provide: APP_GUARD, useExisting: OrgContextGuard },
    // F14a. Interceptors always run after every guard, so `req.ctx` is resolved by the time this reads it.
    OrgScopeInterceptor,
    { provide: APP_INTERCEPTOR, useExisting: OrgScopeInterceptor },
  ],
  exports: [OrgContextService, OrgContextGuard],
})
export class AuthContextModule {}
