import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { HumanResourceController } from './controllers/human-resource.controller';
import { HumanResourceService } from './services/human-resource.service';
import { HumanResourceEntity, HumanResourceSchema } from './schemas/human-resource.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: HumanResourceEntity.name, schema: HumanResourceSchema }]),
    DCMongoDBModule,
  ],
  controllers: [HumanResourceController],
  providers: [HumanResourceService],
  exports: [HumanResourceService],
})
export class HumanResourcesModule {}
