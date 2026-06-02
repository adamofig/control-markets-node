# Social Media Tracker Implementation

This document outlines how the `SocialMediaTracker` module is implemented, specifically focusing on how it relates to storage assets.

## Overview

The `SocialMediaTracker` is responsible for organizing and scheduling social media posts (drafts, scheduled, published). These posts often contain images or videos. To manage these files, the tracker references documents from the `StorageAsset` collection (managed by `@dataclouder/nest-storage`).

We use a **Relational Reference (Mongoose `ref` + `.populate()`)** to link trackers to their media assets. 

## Data Model & Relationship

When a new tracker is created or an asset is attached, the tracker stores the `ObjectId` of the corresponding `StorageAssetEntity`. 

### 1. Typescript Interface (`ISocialMediaTracker`)
The interface defines `asset` to support two states:
- A `string` (the unpopulated ID).
- An `IStorageAsset` (the fully populated object containing the URL, file type, etc.).

```typescript
import { IStorageAsset } from '@dataclouder/nest-storage';

export interface ISocialMediaTracker {
  // ...other fields
  asset?: string | IStorageAsset;
}
```

### 2. Mongoose Schema (`SocialMediaTrackerEntity`)
In the database schema, we use the `@Prop` decorator to instruct Mongoose that this field is an `ObjectId` referencing the `StorageAssetEntity` collection. 

*Note: For TypeScript compilation purposes, the class property is typed as `any` to seamlessly satisfy the interface, while the Mongoose decorator correctly enforces the `ObjectId` database type.*

```typescript
import { Prop, Schema } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ collection: 'social_media_tracker', timestamps: true })
export class SocialMediaTrackerEntity implements ISocialMediaTracker {
  // ...

  @Prop({ required: false, type: Types.ObjectId, ref: 'StorageAssetEntity' })
  asset: any; 
}
```

### 3. Module Configuration (`SocialMediaTrackerModule`)
To make the `StorageAssetEntity` schema available to the tracker module, `StorageAssetModule` is imported directly into the `SocialMediaTrackerModule`.

```typescript
import { StorageAssetModule } from '@dataclouder/nest-storage';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: SocialMediaTrackerEntity.name, schema: SocialMediaTrackerSchema }]),
    StorageAssetModule,
    // ...
  ],
})
export class SocialMediaTrackerModule {}
```

## Querying and Resolving Assets

Because we store references as `ObjectId` strings in the database, Mongoose operations return unpopulated IDs by default. To provide the frontend with full asset details (such as the storage URL and metadata), references must be populated.

### 1. Query-Time Population
For standard queries (e.g. `findOne` or `find`), populate can be requested via Mongoose options:
```typescript
async getTrackerWithAsset(id: string) {
  return this.socialMediaTrackerModel
    .findById(id)
    .populate('asset assets') // <--- Resolves ObjectIds to full StorageAsset objects
    .exec();
}
```

### 2. Write-Time Population (Save & Update)
When a document is created or updated in the backend, the base `EntityCommunicationService` executes the operation and returns the raw saved document. By default, MongoDB returns references as raw string/ObjectId keys (not populated).

If the frontend patches its state using this response, the populated assets would revert to IDs, breaking image/video previews.

To prevent this, `SocialMediaTrackerService` overrides `executeOperation` to intercept write operations and force-populate the `asset` and `assets` paths before returning the document:

```typescript
// social-media-tracker.service.ts
override async executeOperation(operation: any): Promise<any> {
  const result = await super.executeOperation(operation);
  
  // Force population after writes to maintain frontend state integrity
  if (operation && (operation.action === 'updateOne' || operation.action === 'create') && result) {
    await this.genericModel.populate(result, { path: 'asset assets' });
  }
  
  return result;
}
```
This guarantees that any create or update operations return the fully populated asset objects to the frontend.

