# Post assets — canonical contract (final fix) — 2026-05-03

## Root causes

1. **Map markers / map bootstrap:** `buildPostEnvelope` ran with a **minimal seed only** (`MapMarkersFirestoreAdapter.project`, then `MapRepository.listMarkers`). `sourcePost` did not contain Firestore media, so normalization fell through to legacy fallbacks bounded by **`displayPhotoLink` only** → carousel saw **assetCount/metadata vs one repeated URL**.
2. **Compact feed cards (`toFeedCardDTO`):** When `compactAssetLimit` was omitted, the mapper defaulted to **`cap = 1`**, stripping multi-photo posts to a single postcard row (`compact-surface-dto.ts`).
3. **Client carousel:** Legacy expansion only split **comma-separated `photoLink`**, ignoring **`photoLinks2` / `photoLinks3` / nested `legacy.*`** as separate columns. React keys could collide when URIs duplicated.

## Canonical contract (backend)

- **Module:** `src/contracts/post-assets.contract.ts`
- **API:** `normalizePostAssets(rawPost, options)` → canonical `assets[]`, `coverAsset`, `displayPhotoLink`, `photoLink`, `assetCount`, `hasMultipleAssets`, optional **dev-only** `diagnostics`.
- **Envelope bridge:** `normalizedAssetsToEnvelopeRows()` maps canonical rows onto existing client fields (`previewUrl`, `originalUrl`, `streamUrl`, `mp4Url`, `posterUrl`, `playback`).
- **`buildPostEnvelope`:** Imports the normalizer, merges canonical rows onto raw asset objects (preserving unknown Firestore keys), attaches `assetCount` / `hasMultipleAssets`, and in **non-production** `mediaDiagnostics` when diagnostics fire.

### Fallback rules (summary)

| Priority | Source |
|---------|--------|
| Primary | Non-empty modern `assets[]` in-order; playbackLab merge; per-asset type |
| Legacy | Deduped list: comma `photoLink`, `legacy.photoLink`, `photoLinks2`, `legacy.photoLinks2`, `photoLinks3`, `legacy.photoLinks3` |
| Video | Playable URI: **HLS** → **720 AVC** → 720 → 1080…; preview360 retained in `playback`; poster never used as sole `displayUri` |
| Image `displayUri` | `lg.webp` → `md.webp` → `sm.webp` → `fallbackJpg` → `original` → `uri`/`url` |
| Deduping | Drops duplicate **`id`** rows from modern ingestion (Firestore dup guard) |

## Backend routes / surfaces audited

| Surface | Payload type | Assets behavior (after fix) |
|---------|----------------|------------------------------|
| `feed.repository` / bootstrap & page cards | Full post-ish card via `buildPostEnvelope(..., hydrationLevel: "card")` | Full normalized `assets`; list hydration still **slims** variant blobs (`slimEnvelopeAssetsForListHydration`) |
| `feed-detail-firestore.adapter` | Detail bundle | `buildPostEnvelope` detail |
| `feed-for-you` / `feed-for-you-simple` | `toFeedCardDTO` with explicit `carouselCompactAssetCap` | Explicit cap unchanged; global default improved |
| `search.service` / collections (`collections-v2.routes`) | Envelope-backed | Canonical via envelope |
| `mixes.service` / `searchMixes.orchestrator` | `compactAssetLimit: 12` where needed | Already multi-asset capable |
| `posts-detail.orchestrator` | `compactAssetLimit: 12` | Same |
| **Map** `map-markers-firestore.adapter` | Marker + `openPayload` | **`rawPost` + `sourcePost` = Firestore doc`** → full carousel in `openPayload` |
| **Map** `map.repository` `listMarkers` | Marker summary `openPayload` | **Prefer `marker.openPayload`** from adapter (no second “empty” envelope) |
| `map-markers.routes` `ensureMarkerOpenPayload` fallback | Fallback when payload missing | Still thin-by-design unless caller supplies richer `sourcePost` |
| Legacy v1 proxies | Out of Backendv2 contract scope | Not modified |
| Profile post detail adapter | Custom `normalizeAssets` + `defaultAssets` when Firestore omits array | **Not yet unified** on `normalizePostAssets` (see limitations) |

## Client (Native)

| File | Change |
|------|--------|
| `src/utils/postMediaNormalizer.ts` | Shared helper: prefers `assets[]`; legacy comma lists for `photoLinks*`; carousel list builder sets stable `__viewerAssetSessionKey`; `__DEV__` warnings |
| `src/features/liftable/AssetCarouselOnly.tsx` | Builds carousel `list` via `normalizeClientCarouselListFromPost(post)` |

**Note:** Carousel session key duplicated as a string literal in the util **intentionally** to avoid dragging `liftable` into the Vitest graph (see failing parse when importing `liftableOpenSnapshot`). Value matches `liftableOpenSnapshot.ts`.

## Tests added / updated

- `src/contracts/post-assets.contract.test.ts` — modern multi-image, video poster vs playable, legacy dedupe, dup ids, image URI order helper.
- `src/lib/posts/post-envelope.test.ts` — marker + rich Firestore `assets[]` keeps **three** URIs.
- `src/dto/compact-surface-dto.test.ts` snapshots — updated for **`derivedAssetCount`** and multi-asset default cap.
- `Locava-Native/src/utils/postMediaNormalizer.test.ts` — multi-asset, `assetCount` hint trap, legacy commas, carousel keys.

## Dev diagnostics / harness

- **Envelope (non-production):** `mediaDiagnostics` on postcard/marker payloads when normalization emits diagnostics (`route`, `postId`, raw vs normalized counts, `uniqueUriCount`, `source`, `warnings`).
- **Script:** `npm run debug:post-assets` → `scripts/debug-post-assets.mts` (`--postJson`, optional `--postId` with Firestore).

## Verification commands run

```bash
cd "Locava Backendv2"
npx tsc --noEmit
npx vitest run src/contracts/post-assets.contract.test.ts src/lib/posts/post-envelope.test.ts src/dto/compact-surface-dto.test.ts
npm run debug:post-assets

cd "../Locava-Native"
npx vitest run src/utils/postMediaNormalizer.test.ts
```

## Files changed (high level)

- **Backend:** `src/contracts/post-assets.contract.ts` (+ `.test.ts`), `src/lib/posts/post-envelope.ts` (+ `.test.ts`), `src/dto/compact-surface-dto.ts` (+ snapshot), `src/repositories/source-of-truth/map-markers-firestore.adapter.ts`, `src/repositories/surfaces/map.repository.ts`, `package.json` (`debug:post-assets`), `scripts/debug-post-assets.mts`
- **Native:** `src/utils/postMediaNormalizer.ts` (+ `.test.ts`), `src/features/liftable/AssetCarouselOnly.tsx`

## Known limitations / follow-ups

1. **Profile post detail adapter** (`profile-post-detail-firestore.adapter.ts`) still uses **`defaultAssets`** when Firestore lacks `assets[]`; consider routing through `normalizePostAssets` for full parity with envelope + legacy URLs.
2. **Web app** (`Locava Web`): `PostCard.jsx` and admin pages still use `displayPhotoLink` directly for thumbnails; add `postMediaNormalizer` equivalent when web ships multi-asset carousels.
3. **`map-markers.routes` `ensureMarkerOpenPayload` fallback** remains deliberately thin — only used when adapters omit payload.
4. **Payload weight:** Full postcard cap default is **`DEFAULT_CARD_CAROUSEL_ASSET_CAP = 12`**; callers may still pin `compactAssetLimit: 1` for bespoke lightweight rows if ever required.

## Deployment

- Backend: **deploy Cloud Run** (or equivalent) so map markers include Firestore-backed `openPayload` and feed cards serialize up to **12** assets without an explicit flag.
- Native: rebuild / OTA depending on ship channel; carousel changes live in **`AssetCarouselOnly`**.
