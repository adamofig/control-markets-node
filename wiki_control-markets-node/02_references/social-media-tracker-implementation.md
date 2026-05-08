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

## Querying and Resolving the Asset

Because we store the `ObjectId` in the database, backend queries will only return the ID string by default. 

To provide the frontend with the full asset details (like the image or video `url`), you must use Mongoose's `.populate()` method when querying the database.

**Example Service Query:**
```typescript
async getTrackerWithAsset(id: string) {
  return this.socialMediaTrackerModel
    .findById(id)
    .populate('asset') // <--- Replaces the ObjectId with the full StorageAsset object
    .exec();
}
```

By ensuring `.populate('asset')` is called, the frontend can seamlessly access `tracker.asset.url` without making additional API calls.
