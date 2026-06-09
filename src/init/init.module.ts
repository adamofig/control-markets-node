import { Module } from '@nestjs/common';
import { UserModule } from 'src/user/user.module';
import { InitController } from './init.controller';
import { NestUsersModule } from '@dataclouder/nest-users';
import { OrganizationModule } from 'src/organization/organization.module';
import { NestAuthModule } from '@dataclouder/nest-auth';

@Module({
  imports: [NestAuthModule, NestUsersModule, OrganizationModule, UserModule],
  controllers: [InitController],
})
export class InitModule {}

