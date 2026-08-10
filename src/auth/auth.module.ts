import { Global, Module } from '@nestjs/common';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { AuthContextController } from './auth-context.controller';
import { OrganizationModule } from 'src/organization/organization.module';
import { OrgContextService } from './org-context.service';
import { OrgContextGuard } from './org-context.guard';

/**
 * Org-scoped authorization: the role→permission matrix, the context endpoint the frontend reads,
 * and the guard that enforces `@OrgPermission`. `AppUserService` comes from the global `UserModule`.
 *
 * `@Global()` (F11): `OrgContextGuard` is mounted from other modules' controllers — `OrganizationModule`
 * today, every module once F12 registers it as `APP_GUARD`. Exporting it globally avoids making each
 * of those modules import this one, which would create a cycle with `OrganizationModule`.
 *
 * `NestAuthModule` es obligatorio: Nest instancia `ProjectAuthGuard` (usado en `@UseGuards`)
 * dentro de este módulo, así que necesita ver `FirebaseService` acá. Mismo patrón que el resto
 * de módulos que montan el guard localmente.
 */
@Global()
@Module({
  imports: [NestAuthModule, OrganizationModule],
  controllers: [AuthContextController],
  providers: [OrgContextService, OrgContextGuard],
  exports: [OrgContextService, OrgContextGuard],
})
export class AuthContextModule {}
