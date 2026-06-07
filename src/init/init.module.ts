import { Module } from '@nestjs/common';
import { UserModule } from 'src/user/user.module';
import { InitController } from './init.controller';
import { NestUsersModule } from '@dataclouder/nest-users';
import { OrganizationModule } from 'src/organization/organization.module';

@Module({
  imports: [UserModule, NestUsersModule, OrganizationModule],
  controllers: [InitController],
})
export class InitModule {}

