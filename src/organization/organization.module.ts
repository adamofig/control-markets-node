import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrganizationController } from './controllers/organization.controller';
import { OrganizationService } from './services/organization.service';
import { OrganizationEntity, OrganizationSchema } from './schemas/organization.schema';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestStorageModule } from '@dataclouder/nest-storage';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { UserModule } from 'src/user/user.module';

// `NestAuthModule`: el controller monta `ProjectAuthGuard` localmente y Nest lo instancia en este
// módulo, así que `FirebaseService` tiene que ser visible acá.
@Module({
  imports: [MongooseModule.forFeature([{ name: OrganizationEntity.name, schema: OrganizationSchema }]), DCMongoDBModule, NestStorageModule, NestAuthModule, forwardRef(() => UserModule)],
  controllers: [OrganizationController],
  providers: [OrganizationService],
  exports: [OrganizationService],
})
export class OrganizationModule {}
