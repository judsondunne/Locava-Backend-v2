# Photo Post AccessDenied Root Cause (2026-05-07)

## Summary

Backend v2 finalize for image-only posts treated placeholder image paths as final media and marked those posts ready too early.

## Observed Production Symptoms

- Canonical post shape was valid (`schema v2`, `audit.canonicalValidationStatus=valid`, assets/presentation/compatibility present).
- Image URLs were consistently placeholder/public-inaccessible URLs such as:
  - `https://s3.wasabisys.com/locava.app/images/image_<...>_pending.jpg`
- The same `_pending.jpg` URL was copied to:
  - `assets[n].original`, `poster`, `thumbnail`
  - `assets[n].variants.thumb/sm/md/lg/fallbackJpg`
  - `compatibility.displayPhotoLink/photoLink/photoLinks2/photoLinks3/thumbUrl`
  - top-level `displayPhotoLink/photoLink/photoLinks2/photoLinks3/thumbUrl`
  - hydrated cover URL fields
- Runtime readiness was contradictory:
  - `assetsReady: true`
  - hydrated `status/mediaStatus: ready`
  - `imageProcessingStatus: pending`
  - every asset `imageVariantsPending: true`
- Finalize telemetry showed image path counted placeholder variants as if real:
  - `event=native_canonical_post`, `finalizePath=native_v2`, `hasVideo=false`
  - `assetsReady=true`, `variantCount>0`
  - `ladderVariantUrlsPresent=false`, `playbackUrlPresent=false`, `videoTaskEnqueued=false`

## Root Cause

1. Finalized image key planning used `_pending.jpg` as the canonical finalized object key.
2. Image asset assembly fanned a single image URL into all variant slots (`thumb/sm/md/lg/fallbackJpg`) without validating that variants existed.
3. Image finalize readiness used structural presence, not verified public-readability.
4. Hydration/normalization accepted `_pending.jpg` and legacy image links as valid display assets.

## Fix Strategy Implemented

- Switched image finalized key shape from `images/<assetId>_pending.jpg` to `images/<assetId>.jpg`.
- Added photo finalize resolver to:
  - resolve uploaded source key
  - promote/copy to canonical public key when needed
  - verify object existence + public readability before marking image cover ready
- Stopped fabricating image variants from a single URL.
- Made image readiness require confirmed safe cover URL (no `_pending.jpg`, no staging path).
- Added hydration/normalization guards to drop pending placeholder image URLs.
- Added dry-run repair script for already-broken docs:
  - `scripts/repair-broken-photo-pending-urls.mts`

## Safety Notes

- Video finalize/faststart path was left intact.
- Letterbox gradients are preserved via existing per-asset/post gradient flow.
- Likes/comments source-of-truth behavior remains unchanged.
