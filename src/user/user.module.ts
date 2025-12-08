import { Module, forwardRef } from '@nestjs/common'; // Import forwardRef
import { MongooseModule } from '@nestjs/mongoose';
import { UserEntity, UserSchema } from './user.entity';
import { UserController } from './user.controller';
import { AppUserService } from './user.service';
// import { FirebaseService } from '../common/firebase.service'; // Removed local import
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import config from '../config/environment';
import { NestAuthModule } from '@dataclouder/nest-auth'; // Added import
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { OrganizationModule } from '../organization/organization.module';

@Module({
  imports: [MongooseModule.forFeature([{ name: UserEntity.name, schema: UserSchema }]), HttpModule, ConfigModule.forFeature(config), NestAuthModule, DCMongoDBModule, OrganizationModule],
  controllers: [UserController],
  providers: [AppUserService], // Removed FirebaseService
  exports: [AppUserService], // Removed FirebaseService
})
export class UserModule {}
