# Skill: Create New Entity (Entity T Framework)

Use this guide when the user asks to create a new NestJS entity/module/collection following the project's scaffold pattern.

the entity scafold pattern is create a new model that can potentially be used in multiple places, but frontend will use a lot, making easy and standarized way of calling endpoints. 



## Overview

Every new entity follows this structure:

```
src/<entity-name>/
  models/<entity-name>.models.ts
  schemas/<entity-name>.schema.ts
  services/<entity-name>.service.ts
  controllers/<entity-name>.controller.ts
  <entity-name>.module.ts
```

Replace `<EntityName>` with PascalCase (e.g. `Lesson`) and `<entity-name>` with kebab-case (e.g. `lesson`).

---

### `models/<entity-name>.models.ts`

```typescript
import { IAuditable } from '@dataclouder/nest-core';

this is an example, the entity can have any property, id, name, description and auditable are mandatory to include in the model unless user say otherwise. 

export interface I<EntityName> {
  _id?: string;
  id?: string;
  name?: string;
  description?: string;
  content?: string;
  image?: any;
  auditable?: IAuditable;
}
```

### `schemas/<entity-name>.schema.ts`

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { I<EntityName> } from '../models/<entity-name>.models';
import { AuditDataSchema, IAuditable } from '@dataclouder/nest-core';

export type <EntityName>Document = <EntityName>Entity & Document;

@Schema({ collection: '<entity-name>', timestamps: true })
export class <EntityName>Entity implements I<EntityName> {
  @Prop({ required: false })
  id: string;

  @Prop({ required: false })
  name: string;

  @Prop({ required: false })
  description: string;

  @Prop({ required: false })
  content: string;

  @Prop({ required: false, type: Object })
  image: any;

  @Prop({ type: AuditDataSchema, required: false, default: {} })
  auditable: IAuditable;
}

export const <EntityName>Schema = SchemaFactory.createForClass(<EntityName>Entity);

addIdAfterSave(<EntityName>Schema);

<EntityName>Schema.index({ id: 1 }, { unique: true });
```

### `services/<entity-name>.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { <EntityName>Entity, <EntityName>Document } from '../schemas/<entity-name>.schema';
import { MongoService, EntityCommunicationService } from '@dataclouder/nest-mongo';

@Injectable()
export class <EntityName>Service extends EntityCommunicationService<<EntityName>Document> {
  constructor(
    @InjectModel(<EntityName>Entity.name)
    <entityName>Model: Model<<EntityName>Document>,
    mongoService: MongoService,
  ) {
    super(<entityName>Model, mongoService);
  }
}
```

### `controllers/<entity-name>.controller.ts`

```typescript
import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { <EntityName>Service } from '../services/<entity-name>.service';
import { EntityMongoController } from '@dataclouder/nest-mongo';
import { <EntityName>Document } from '../schemas/<entity-name>.schema';

@ApiTags('<entity-name>')
@Controller('api/<entity-name>')
export class <EntityName>Controller extends EntityMongoController<<EntityName>Document> {
  constructor(private readonly <entityName>Service: <EntityName>Service) {
    super(<entityName>Service);
  }
}
```

### `<entity-name>.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { <EntityName>Controller } from './controllers/<entity-name>.controller';
import { <EntityName>Service } from './services/<entity-name>.service';
import { <EntityName>Entity, <EntityName>Schema } from './schemas/<entity-name>.schema';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestStorageModule } from '@dataclouder/nest-storage';
import { NestAuthModule } from '@dataclouder/nest-auth';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: <EntityName>Entity.name, schema: <EntityName>Schema }]),
    DCMongoDBModule,
    NestStorageModule,
    NestAuthModule,
  ],
  controllers: [<EntityName>Controller],
  providers: [<EntityName>Service],
  exports: [<EntityName>Service],
})
export class <EntityName>Module {}
```

### Register in `app.module.ts`

```typescript
import { <EntityName>Module } from './<entity-name>/<entity-name>.module';

@Module({
  imports: [
    // ...existing modules...
    <EntityName>Module,
  ],
})
export class AppModule {}
```

---

## Endpoints provided automatically

| Method | Path                        | Description                                            |
|--------|-----------------------------|--------------------------------------------------------|
| GET    | `/api/<entity-name>`        | Get all                                                |
| GET    | `/api/<entity-name>/:id`    | Get by id                                              |
| POST   | `/api/<entity-name>`        | Create or full update (if id present, overrides doc)   |
| PUT    | `/api/<entity-name>/:id`    | Partial update root-level fields (ignores nulls)       |
| PATCH  | `/api/<entity-name>/:id`    | Granular update via dot-notation flattened paths       |
| POST   | `/api/<entity-name>/query`  | Query with filters, pagination, sorting                |
| DELETE | `/api/<entity-name>/:id`    | Delete by id                                           |

---

## Update strategies

**POST** — full override. Send the whole object; missing fields are lost.

**PUT** — root-level partial. Nulls and undefineds are ignored.
```json
{ "name": "new name", "description": null }
```
Only `name` is updated.

**PATCH** — granular dot-notation. Touches only the specified nested paths.
```json
{ "video.captions.remotion.captions": [...] }
```
