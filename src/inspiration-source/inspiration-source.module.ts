import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InspirationSourceController } from './controllers/inspiration-source.controller';
import { InspirationSourceService } from './services/inspiration-source.service';
import { InspirationSourceEntity, InspirationSourceSchema } from './schemas/inspiration-source.schema';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestStorageModule } from '@dataclouder/nest-storage';
import { NestAuthModule } from '@dataclouder/nest-auth';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: InspirationSourceEntity.name, schema: InspirationSourceSchema }]),
    DCMongoDBModule,
    NestStorageModule,
    NestAuthModule,
  ],
  controllers: [InspirationSourceController],
  providers: [InspirationSourceService],
  exports: [InspirationSourceService],
})
export class InspirationSourceModule {}
