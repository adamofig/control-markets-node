import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { RecentResourceEntity, RecentResourceSchema } from './schemas/recent-resource.schema';
import { RecentResourcesService } from './services/recent-resources.service';
import { RecentResourcesController } from './controllers/recent-resources.controller';
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: RecentResourceEntity.name, schema: RecentResourceSchema }]),
    DCMongoDBModule,
    NestAuthModule,
    UserModule,
  ],
  controllers: [RecentResourcesController],
  providers: [RecentResourcesService],
  exports: [RecentResourcesService],
})
export class RecentResourcesModule {}
