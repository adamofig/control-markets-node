import { Module } from '@nestjs/common';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { AuthContextController } from './auth-context.controller';
import { OrganizationModule } from 'src/organization/organization.module';

/**
 * Org-scoped authorization: the role→permission matrix and the context endpoint the frontend reads.
 * `AppUserService` comes from the global `UserModule`.
 *
 * `NestAuthModule` es obligatorio: Nest instancia `ProjectAuthGuard` (usado en `@UseGuards`)
 * dentro de este módulo, así que necesita ver `FirebaseService` acá. Mismo patrón que el resto
 * de módulos que montan el guard localmente.
 */
@Module({
  imports: [NestAuthModule, OrganizationModule],
  controllers: [AuthContextController],
})
export class AuthContextModule {}
