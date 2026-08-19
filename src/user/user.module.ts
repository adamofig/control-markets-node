import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserEntity, UserSchema } from './user.entity';
import { UserController } from './user.controller';
import { AppUserService } from './user.service';
import { ProjectAuthGuard } from './project-auth.guard';
import { SystemMasterTokenService } from './system-master-token.service';
import { EphemeralAgentTokenService } from './ephemeral-agent-token.service';
// import { FirebaseService } from '../common/firebase.service'; // Removed local import
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import config from '../config/environment';
import { AuthGuard, NestAuthModule } from '@dataclouder/nest-auth';
import { DC_ENTITY_GUARD, DCMongoDBModule } from '@dataclouder/nest-mongo';
import { OrganizationModule } from '../organization/organization.module';

/**
 * F12 note — the global `APP_GUARD` registration of `ProjectAuthGuard` does **not** live here, it
 * lives in `AuthContextModule` next to `OrgContextGuard`. Nest applies global enhancers in the order
 * the modules are scanned, so registering the two of them in two different modules makes the order
 * "authenticate, then authorize" an accident of the import list in `app.module.ts`. If `OrgContextGuard`
 * ever ran first, `request.decodedToken` would be undefined and every `req.ctx` would resolve to an
 * anonymous context — failing open on default-closed routes and denying every `@OrgPermission`.
 * Registering both in one `providers` array is what makes that order explicit and stable.
 *
 * ---
 *
 * ## `DC_ENTITY_GUARD` — quién autentica las rutas genéricas de `@dataclouder/nest-mongo`
 *
 * `EntityMongoController.executeOperation` y las 8 rutas de `EntityController` llevan un guard puesto
 * **dentro de la librería**. Hasta `nest-mongo@1.2.1` ese guard era el `AuthGuard` de Firebase, fijo, y
 * no había forma de cambiarlo desde acá: `@UseGuards(Clase)` no se resuelve por token de DI — Nest
 * registra un injectable cuyo `metatype` **es** la clase y la instancia desde ahí (`Module.addInjectable`),
 * así que el `{ provide: AuthGuard, useClass: ProjectAuthGuard }` de abajo **nunca lo tocaba**. Resultado:
 * ningún `cm_pat_*` ni el token maestro podían usar `POST /api/<entidad>/operation` en los 10
 * controladores que no sobreescriben el método.
 *
 * La librería ahora declara un guard delegador y pregunta por este token. `useExisting` y no `useClass`
 * a propósito: queremos **la misma instancia** que ya resuelve el resto de la app, no una segunda con su
 * propia conexión al modelo de usuarios.
 *
 * El alias `AuthGuard` de abajo alcanzaría — `EntityGuard` lo busca como segundo nivel de resolución —
 * pero depender de eso es depender de un alias que existe para otra cosa y que alguien puede borrar sin
 * saber qué rompe. El binding explícito es la declaración de intención.
 */
@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: UserEntity.name, schema: UserSchema }]), HttpModule, ConfigModule.forFeature(config), NestAuthModule, DCMongoDBModule, OrganizationModule],
  controllers: [UserController],
  providers: [
    AppUserService,
    SystemMasterTokenService,
    EphemeralAgentTokenService,
    ProjectAuthGuard,
    { provide: AuthGuard, useClass: ProjectAuthGuard },
    { provide: DC_ENTITY_GUARD, useExisting: ProjectAuthGuard },
  ],
  exports: [
    AppUserService,
    SystemMasterTokenService,
    EphemeralAgentTokenService,
    ProjectAuthGuard,
    { provide: AuthGuard, useClass: ProjectAuthGuard },
    { provide: DC_ENTITY_GUARD, useExisting: ProjectAuthGuard },
    MongooseModule,
  ],
})
export class UserModule {}
