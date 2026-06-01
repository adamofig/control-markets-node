import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BlogEntryController } from './controllers/blog-entry.controller';
import { BlogEntryService } from './services/blog-entry.service';
import { BlogEntryEntity, BlogEntrySchema } from './schemas/blog-entry.schema';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { OrganizationModule } from '../organization/organization.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: BlogEntryEntity.name, schema: BlogEntrySchema }]),
    DCMongoDBModule,
    NestAuthModule,
    OrganizationModule,
  ],
  controllers: [BlogEntryController],
  providers: [BlogEntryService],
  exports: [BlogEntryService],
})
export class BlogEntryModule {}
