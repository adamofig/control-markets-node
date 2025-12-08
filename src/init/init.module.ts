import { Module } from '@nestjs/common';
import { UserModule } from 'src/user/user.module';
import { InitController } from './init.controller';
import { NestUsersModule } from '@dataclouder/nest-users';

@Module({
  imports: [UserModule, NestUsersModule],
  controllers: [InitController],
})
export class InitModule {}
