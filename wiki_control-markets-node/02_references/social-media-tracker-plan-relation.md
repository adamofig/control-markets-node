# Social Post Tracker — Asset Relation Options

The `asset` field on `ISocialMediaTracker` is intended to reference a document in the `storage_assets` collection, managed by `@dataclouder/nest-storage`. This document describes the three viable implementation strategies.

---

## Current State

`asset` is typed as `any` and stored as `{ type: Object }` in the Mongoose schema. It has no formal link to `StorageAssetEntity`.

`NestStorageModule` is already imported in `SocialMediaTrackerModule` (provides cloud file I/O). `StorageAssetModule` — which registers `StorageAssetEntity` in Mongoose and exports `StorageAssetService` — is not yet imported.

---

## Option A — Mongoose `ref` + `.populate()` (relational reference) ✅ Recommended

Store the MongoDB `_id` (ObjectId) as a foreign key. Resolve the full asset document via Mongoose populate.

### Schema change

```ts
import { Types } from 'mongoose';
import { StorageAssetEntity } from '@dataclouder/nest-storage';

@Prop({ type: mongoose.Schema.Types.ObjectId, ref: StorageAssetEntity.name, required: false })
asset: Types.ObjectId;
```

### Interface change

```ts
import { IStorageAsset } from '@dataclouder/nest-storage';

asset?: string | IStorageAsset; // string when stored, populated object when resolved
```

### Module change

Replace `NestStorageModule` with `StorageAssetModule` in `social-media-tracker.module.ts` (it re-exports the storage provider internally):

```ts
import { StorageAssetModule } from '@dataclouder/nest-storage';

@Module({
  imports: [..., StorageAssetModule],
})
```

### Query change (service)

```ts
this.model.find(filter).populate('asset');
```

**Pros**
- Single source of truth — asset data is always fresh.
- Enables queries filtered on asset fields across collections.

**Cons**
- Every read that needs the asset must call `.populate('asset')`.
- Slightly more complex service layer.

**Best for:** cases where you need to query by asset fields, or where the asset metadata may change after being linked to a post.

---

## Option B — Embedded `IStorageAsset` snapshot (denormalized)

Store a full copy of the asset object inline. No extra queries or module changes required.

### Schema change

```ts
import { StorageAssetSchema, StorageAssetEntity } from '@dataclouder/nest-storage';

@Prop({ required: false, type: StorageAssetSchema })
asset: StorageAssetEntity;
```

### Interface change

```ts
import { IStorageAsset } from '@dataclouder/nest-storage';

asset?: IStorageAsset;
```

No module change needed.

**Pros**
- Zero extra queries — the asset is returned with the tracker document.
- Simplest implementation — only the type annotation changes.
- Works with the existing module setup.

**Cons**
- Snapshot can go stale if the source asset is updated in `storage_assets` after being linked.

**Best for:** social post tracker use case — the asset is typically attached once when the post is created and does not change. Stale data is not a practical concern.

---

## Option C — String `id` reference + `StorageAssetService` injection

Store the nanoid string from `StorageAssetEntity.id`. Resolve the full document on demand via the service.

### Schema change

```ts
@Prop({ required: false, type: String })
assetId: string;
```

### Interface change

```ts
assetId?: string;
```

### Module change

```ts
import { StorageAssetModule } from '@dataclouder/nest-storage';

@Module({
  imports: [..., StorageAssetModule],
})
```

### Service change

```ts
import { StorageAssetService } from '@dataclouder/nest-storage';

constructor(
  ...,
  private storageAssetService: StorageAssetService,
) {}

async getTrackerWithAsset(id: string) {
  const tracker = await this.findOne(id);
  const asset = tracker.assetId
    ? await this.storageAssetService.findOne(tracker.assetId)
    : null;
  return { ...tracker.toObject(), asset };
}
```

**Pros**
- Full control over when and how the asset is resolved.
- Uses the nanoid `id` (same key the frontend uses) rather than the internal ObjectId.

**Cons**
- Most boilerplate of the three options.
- Two concepts to maintain (`assetId` reference + resolved `asset` object).

**Best for:** cases where asset resolution is conditional or expensive and you want explicit control.

---

## Decision Matrix

| Criterion | Option A (ref/populate) | Option B (snapshot) | Option C (service inject) |
| :--- | :---: | :---: | :---: |
| Data freshness | Always fresh | Snapshot at link time | Always fresh |
| Query complexity | Medium | Low | Low |
| Extra DB round-trips | Yes (populate) | No | Yes (manual) |
| Module changes needed | Yes | No | Yes |
| Boilerplate | Low | Minimal | High |
| Recommended | ✅ | — | — |

---

## Implementation Plan (Option A)

1. Update `ISocialMediaTracker` — replace `asset?: any` with `asset?: string | IStorageAsset`.
2. Update `SocialMediaTrackerEntity` schema — change `@Prop({ type: Object }) asset: any` to `@Prop({ type: Types.ObjectId, ref: 'StorageAssetEntity' }) asset: Types.ObjectId`.
3. Update `SocialMediaTrackerModule` — import `StorageAssetModule` instead of `NestStorageModule`.
4. Ensure your service queries use `.populate('asset')` (or configure your base service to do so) whenever full asset details are needed by the frontend.
