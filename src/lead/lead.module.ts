import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeadController } from './controllers/lead.controller';
import { LeadService } from './services/lead.service';
import { LeadEntity, LeadSchema } from './schemas/lead.schema';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestStorageModule } from '@dataclouder/nest-storage';
import { NestAuthModule } from '@dataclouder/nest-auth';

// `NestAuthModule`: Nest instantiates `ProjectAuthGuard` (F10, class-level) inside this module, so
// `FirebaseService` has to be visible here. Same pattern as every other module mounting the guard.
@Module({
  imports: [MongooseModule.forFeature([{ name: LeadEntity.name, schema: LeadSchema }]), DCMongoDBModule, NestStorageModule, NestAuthModule],
  controllers: [LeadController],
  providers: [LeadService],
  exports: [LeadService],
})
export class LeadModule {}
