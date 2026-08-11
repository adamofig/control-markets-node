import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserEntity, UserSchema } from './user.entity';
import { UserController } from './user.controller';
import { AppUserService } from './user.service';
import { ProjectAuthGuard } from './project-auth.guard';
import { SystemMasterTokenService } from './system-master-token.service';
// import { FirebaseService } from '../common/firebase.service'; // Removed local import
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import config from '../config/environment';
import { AuthGuard, NestAuthModule } from '@dataclouder/nest-auth';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { OrganizationModule } from '../organization/organization.module';

/**
 * F12 note — the global `APP_GUARD` registration of `ProjectAuthGuard` does **not** live here, it
 * lives in `AuthContextModule` next to `OrgContextGuard`. Nest applies global enhancers in the order
 * the modules are scanned, so registering the two of them in two different modules makes the order
 * "authenticate, then authorize" an accident of the import list in `app.module.ts`. If `OrgContextGuard`
 * ever ran first, `request.decodedToken` would be undefined and every `req.ctx` would resolve to an
 * anonymous context — failing open on default-closed routes and denying every `@OrgPermission`.
 * Registering both in one `providers` array is what makes that order explicit and stable.
 */
@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: UserEntity.name, schema: UserSchema }]), HttpModule, ConfigModule.forFeature(config), NestAuthModule, DCMongoDBModule, OrganizationModule],
  controllers: [UserController],
  providers: [AppUserService, SystemMasterTokenService, ProjectAuthGuard, { provide: AuthGuard, useClass: ProjectAuthGuard }],
  exports: [AppUserService, SystemMasterTokenService, ProjectAuthGuard, { provide: AuthGuard, useClass: ProjectAuthGuard }, MongooseModule],
})
export class UserModule {}
