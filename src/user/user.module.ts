import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserEntity, UserSchema } from './user.entity';
import { UserController } from './user.controller';
import { AppUserService } from './user.service';
import { ProjectAuthGuard } from './project-auth.guard';
// import { FirebaseService } from '../common/firebase.service'; // Removed local import
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import config from '../config/environment';
import { AuthGuard, NestAuthModule } from '@dataclouder/nest-auth';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { OrganizationModule } from '../organization/organization.module';

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: UserEntity.name, schema: UserSchema }]), HttpModule, ConfigModule.forFeature(config), NestAuthModule, DCMongoDBModule, OrganizationModule],
  controllers: [UserController],
  providers: [AppUserService, ProjectAuthGuard, { provide: AuthGuard, useClass: ProjectAuthGuard }],
  exports: [AppUserService, ProjectAuthGuard, { provide: AuthGuard, useClass: ProjectAuthGuard }, MongooseModule],
})
export class UserModule {}
