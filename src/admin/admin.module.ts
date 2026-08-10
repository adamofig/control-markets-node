import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { UserModule } from '../user/user.module';

// `NestAuthModule`: Nest instantiates `ProjectAuthGuard` (F10, class-level) inside this module, so
// `FirebaseService` has to be visible here. Same pattern as every other module mounting the guard.
@Module({
  imports: [UserModule, NestAuthModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
