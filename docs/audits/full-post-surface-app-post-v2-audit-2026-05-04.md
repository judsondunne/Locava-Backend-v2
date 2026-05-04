# Full post surface audit — AppPostV2 / Master Post V2

**Date:** 2026-05-04  
**Scope:** Locava Backendv2 + Locava-Native — inventory and risk classification only.  
**No product behavior changes** in the original audit pass (audit scripts, generated inventories, and this document only).

---

## Fixed in follow-up implementation pass (2026-05-04)

| Finding | Resolution |
|--------|------------|
| Home `/v2/feed/bootstrap` and `/v2/feed/page` dropped `appPost` / `postContractVersion` | **`wireFeedCandidateToPostCardSummary`** (`src/lib/feed/feed-post-card-wire.ts`) now preserves canonical fields + diagnostics (`appPostAttached`, `appPostWireAssetCount`, `wireDeclaredMediaAssetCount`). Orchestrators call it instead of a stripping allowlist. |
| `details:batch` + open could finalize on `post_card_cache` only | For **`hydrationMode` `open` or `full`**, **`post_card_cache` alone is rejected** — item goes to **`missing`** with `post_card_cache_rejected_open_hydration`; native **`hydratePostDetailsBatch`** triggers **`hydratePostDetail`** for missing IDs. |
| `runHydrated` cleared `assets` when Firestore returned an empty array | **Always pass through `detail.assets`** as an array (possibly empty) so **`appPost` on the same detail object** remains the carousel source for native. |
| Native batch merged stale shells over canonical detail | When **`postContractVersion === 2`** or incoming has populated **`appPost`/`appPostV2` media.assets**, **replace** cache/entity row instead of **`mergePostEnvelopes`**. Open batch uses **`hydrationMode: "full"`**. |
| Prefetch / video warm used legacy `post.assets` | **`nativeVideoPrefetch.prefetchNativeLiftableVideosForPostAssets`** warms URLs from **`getPostMediaAssetsFromRecord` + `getPostPlaybackUrlsFromAsset`** first; **`liftablePrecache`** first-carousel URI prefers **`getFirstCanonicalCarouselPrefetchUriFromRecord`**. |
| Mixes poster from legacy thumbs first | **`mapPostCard`** prefers **`appPost.media.cover`** URLs before legacy thumb/displayPhotoLink. |
| Finalize kept optimistic merge | **`postEntityStore.upsert`** canonical slice + **`invalidatePostDetailCache`** after finalize. |
| Feed activities from top-level only | **`feedV2.normalize`** uses **`getPostActivities`**; **`getPostPrimaryActivity`** added for compact labels. |
| Contract / tests | **`PostCardSummarySchema`** extended for wire diagnostics; **Vitest** updated for batch open + **`feed-post-card-wire`**. |

**Remaining risks:** legacy **`GET /v2/posts/:postId/detail`** may still return **`post_card_cache` fallback** when SoT is down (intentional degraded UX). Deep-link-only surfaces not exhaustively re-tested here. Re-run **`npm run audit:post-surfaces`** to refresh JSON inventories after large diffs.

**Machine inventories**

- `docs/audits/full-post-surface-backend-inventory-2026-05-04.json`
- `docs/audits/full-post-surface-native-inventory-2026-05-04.json`
- `docs/audits/full-post-surface-inventory-summary-2026-05-04.md` (script summary)
- Script: `scripts/audits/full-post-surface-inventory.mts` — `npm run audit:post-surfaces`

**Scan scale (line-level pattern matches; a line can match multiple patterns)**

| Repo | Line hits scanned | Unique files with ≥1 hit |
|------|------------------:|-------------------------:|
| Backend V2 (`src` + `scripts`) | 2280 | 163 |
| Native (`src`) | 4172 | 683 |

---

## 1. Executive summary

| Question | Answer | Notes |
|----------|--------|--------|
| Is new post-maker canonical (Master Post V2 born in Firestore)? | **Yes (by product statement + finalize path)** | Posting finalize / canonical writer paths are separate from this read/display audit; debug scripts reference `normalizeMasterPostV2` / finalize. |
| Is backend **read** path fully canonical (every post-returning route always returns `appPost` + `postContractVersion` where appropriate)? | **No** | **Primary gap:** `GET /v2/feed/bootstrap` and `GET /v2/feed/page` orchestrators map feed items with an explicit field list that **omits** `appPost` and `postContractVersion`, even though `buildPostEnvelope` (used when building feed cards in the repository) attaches them at runtime on the candidate record. **Contrast:** For You (`toFeedCardDTO` in `feed-for-you.service.ts`) projects AppPostV2 when the backend flag is on. |
| Is native display path fully canonical? | **No** | Strong AppPostV2 usage in liftable carousel (`AssetCarouselOnly`), mixes (`mixPostMedia`), collections heavy path, `getHeroUri`, and several surfaces — but **legacy thumb/photoLink/displayPhotoLink** remain widely used (tiles, prefetch, mixes shelf collage, parts of collections). |
| Remaining high-risk surfaces? | **Yes** | Home **explore/following** feed wire shape vs. contract; **post detail / batch** merging legacy compatibility fields with `post_card_cache`; **mixes** service poster selection from legacy top-level fields; **native** `PostTile` / `liftablePrecache` / `mediaPrefetchCoordinator` using `post.assets` / `assets[0]`; **ActivityMixesShelf** collage thumbs from legacy fields. |

---

## 2. Backend route inventory

Legend: **Posts?** = response can include post-like payloads. **AppPost** = `appPost` on the primary card/summary object (not only nested debug). **Full media** = all carousel assets on the card (vs cover-only contract). **Hydrate** = client expected to call detail/batch before full viewer.

| Route (method path) | Primary files | Posts? | `appPost` on wire | `postContractVersion` | Full `media.assets` on card | Cover-only intentional? | Detail hydrate | Legacy SOT risk | Cache | Known risk | Follow-up (recommendation only) |
|---------------------|---------------|--------|-------------------|------------------------|----------------------------|---------------------------|----------------|-----------------|-------|------------|----------------------------------|
| `GET /v2/feed/bootstrap` | `feed-bootstrap.routes.ts`, `feed-bootstrap.orchestrator.ts`, `feed.service.ts`, `feed.repository.ts` | Yes | **Often missing** (stripped in orchestrator map) | Same | Partial / envelope-limited assets; `mediaCompleteness` can be `cover_only` | Yes when flagged | Yes for multi-asset gaps | Legacy shell fields still populated | `globalCache` bootstrap + candidate lists | **P0:** canonical `appPost` built then dropped from JSON | Spread `appPost`/`postContractVersion` (or passthrough item) in orchestrator |
| `GET /v2/feed/page` | `feed-page.routes.ts`, `feed-page.orchestrator.ts` | Yes | **Often missing** | Same | Same | Same | Same | Same | Page list cache 6s | Same as bootstrap | Same |
| `GET /v2/feed/for-you` | `feed-for-you.routes.ts`, `feed-for-you.orchestrator.ts`, `feed-for-you.service.ts` | Yes | **Yes when** `BACKEND_APP_POST_V2_RESPONSES` on (`toFeedCardDTO`) | 2 when enabled | Compact cap (≤12 assets) by design | Possible `cover_only` / `rawFirestoreAssetCount` via DTO | Partial; batch for playback | DTO still carries legacy compatibility | Repository + orchestration | Card cap vs raw count | Ensure native consumes `appPost` first |
| `GET /v2/feed/for-you/simple` | `feed-for-you-simple.routes.ts` + service/repo | Yes | Same family as for-you | Same | Same | Same | Same | Same | Same | Same | Same |
| `GET /v2/feed/items/:postId/detail` | `feed-item-detail.routes.ts`, `feed-detail` adapters | Yes (detail) | Via `PostDetailSchema` / envelope merge | Contract allows | Detail-level assets | N/A | Preferred full open | Orchestrator merges cached + Firestore | Entity cache | `post_card_cache` upgrade paths | Document `cardSummary.appPost` vs root |
| `GET /v2/posts/:postId/detail` | `posts-detail.routes.ts`, `posts-detail.orchestrator.ts` | Yes | In envelope / cardSummary paths | Contract allows | Full after hydration | N/A | Batch + open modes | **High** — legacy summary fields merged from cache | Cache + Firestore | Stale carousel until upgrade | Audit native open path uses batch `full` |
| `POST /v2/posts/details:batch` | same | Yes | Per-item detail | Same | Mode-dependent | N/A | **Yes** | Same | Same | **P1** hydration modes | Native must request correct `hydrationMode` |
| `GET /v2/profiles/:userId/bootstrap` | `profile.routes.ts`, `profile-bootstrap.orchestrator.ts` | Grid previews | **Partial** — `enrichGridPreviewItemsWithAppPostV2` | When enriched | Grid is cover-first | Intentional for grid | Profile post detail for full | Legacy grid fields | Caches | OK if enrich runs | Confirm flag + errors |
| `GET /v2/profiles/:userId/grid` | `profile-grid.routes.ts`, `profile-grid.orchestrator.ts` | Yes | Same enrichment pattern | When enriched | Cover-first | Intentional | Yes | Same | Same | Same | Same |
| `GET /v2/profiles/:userId/posts/:postId/detail` | `profile-post-detail.routes.ts`, adapters | Yes | Envelope / AppPost projection | When enabled | Detail | N/A | Optional | Same as feed detail | Same | Same | Same |
| `GET /v2/search/bootstrap` (+ `POST`) | `search-discovery.routes.ts` | Cards + discovery | `attachAppPostV2ToSearchDiscoveryRow` where used | When attached | Varies by row builder | Some discovery rows cover-only | Often | Legacy `postToSearchRow` paths | Mix cache / route cache | Partial projection | Grep `search-discovery` + `postToSearchRow` |
| `POST /v2/search/live` | `search-discovery.routes.ts` | Previews | Partial | Partial | Partial | Yes | Yes | Medium | Same | latency vs completeness | — |
| `GET /v2/search/results` | `search-results.routes.ts`, `search.service.ts` | Yes | `buildPostEnvelope` on items | When enabled | Envelope | Can be cover-only | Yes | Legacy fields on envelope | Same | Same | Native `searchResultsSurface` uses `getHeroUri` |
| `GET /v2/search/mixes/bootstrap` | `search-mixes.routes.ts` | Mix metadata + post cards | Via mixes pipeline | Varies | Mix card builder | Often poster-first | Yes | **mixes.service `mapPostCard`** uses thumb/displayPhotoLink/photoLink | `mixCache` | **P1 legacy SOT for poster** | Prefer `appPost` if row has Firestore raw |
| `POST /v2/search/mixes/feed` | same | Yes | Same | Same | Same | Same | Same | Same | Same | Same | Same |
| `GET/POST /v2/mixes/*` | `search-discovery.routes.ts`, `mixes.routes.ts` | Yes | Same family | Same | Same | Same | Same | Same | Same | Same | Same |
| `GET /v2/search/home/v1` | `search-home-v1.routes.ts` | May reference posts | Verify in follow-up | Verify | Verify | — | — | — | — | **needs_manual_review** (smaller surface) | Contract read in follow-up |
| `GET /v2/map/bootstrap` | `map-bootstrap.routes.ts` | Markers / previews | Marker DTO strategy | Varies | Marker payload budget | **Intentional** marker slimming | Yes | Legacy lat/lng + thumb | Route + optional prime | Marker ≠ full post | Document expected hydration |
| `GET /v2/map/markers` | `map-markers.routes.ts`, adapters | Yes | Projection helpers in app-post-v2 | When enabled | Compact | Intentional | Yes | legacy thumb | Cache | Same | Same |
| `GET/POST /v2/collections*` | `collections-v2.routes.ts`, `collections-saved.routes.ts`, manage routes | Yes | `buildPostEnvelope` in v2 routes | When enabled | Full in detail paths; list may slim | Some list rows | Yes | **collections-v2** still derives poster from `thumbUrl` / `displayPhotoLink` for some shells | — | **P1** dual path | Unify on `appPost.media.cover` |
| `GET /v2/notifications` | `notifications-list.routes.ts`, `notifications.repository.ts` | Post on applicable types | **Likely yes** on `post` object from `loadPostCardSummaryBatch` (envelope) | When enabled on card | Card-level | Preview `thumbUrl` separate legacy | Open post uses batch/detail | `preview.thumbUrl` from metadata | Cache read state | Thumb may diverge from `post.appPost` | Align preview thumb with `appPost` cover |
| `GET /v2/chats/inbox` | `chats-inbox.routes.ts` | Optional post refs | Unlikely on list | — | — | — | — | Low | — | — | — |
| `GET /v2/chats/:conversationId/messages` | `chats-thread.routes.ts`, `chats-thread.orchestrator.ts` | Shared post payloads | **Partial** — verify `toAppChatSharedPostV2` usage in service | Partial | Partial | Likely | Yes if opens viewer | Legacy embedded post JSON | — | **P1** | Inventory shared-post mapper |
| `POST /v2/chats/.../send` (and related) | `chats-send-message.routes.ts` | Accepts post refs | N/A | N/A | N/A | N/A | N/A | Client-originated | — | — | — |
| `POST /v2/posting/finalize` (+ staging/media routes) | `posting-finalize.routes.ts`, posting `*.routes.ts` | Writes / returns finalized post | Writer + response contract | 2 | Full in response when included | N/A | N/A | Compatibility fields written | — | **Out of scope for “fix”** per audit request | Already canonical by product statement |
| Legacy: `legacy-bootstrap`, product proxy, reels near me | `compat/*` | Often | **proxy_not_transformable** or partial stubs | Unlikely | Unlikely | — | Native may use V2 elsewhere | **P0/P1** if still primary for some builds | — | Map cutover flags | Deprecation timeline |

**Why `needs_manual_review` is minimal on major routes:** each row above ties to an orchestrator or contract file; remaining unknowns are low-traffic v1 search home or admin-only paths — called out explicitly.

**Critical code evidence — feed bootstrap strips `appPost`**

```137:158:Locava Backendv2/src/orchestration/surfaces/feed-bootstrap.orchestrator.ts
          items: candidates.map((item, idx) => ({
            postId: item.postId,
            rankToken: `rank-${viewer.viewerId.slice(0, 6)}-${idx + 1}`,
            author: item.author,
            activities: item.activities,
            address: item.address,
            carouselFitWidth: item.carouselFitWidth,
            layoutLetterbox: item.layoutLetterbox,
            letterboxGradientTop: item.letterboxGradientTop,
            letterboxGradientBottom: item.letterboxGradientBottom,
            letterboxGradients: item.letterboxGradients,
            geo: item.geo,
            assets: item.assets,
            title: item.title,
            captionPreview: item.captionPreview,
            firstAssetUrl: item.firstAssetUrl,
            media: item.media,
            social: item.social,
            viewer: item.viewer,
            createdAtMs: item.createdAtMs,
            updatedAtMs: item.updatedAtMs
          }))
```

`buildPostEnvelope` still attaches `appPost` when the flag is on:

```600:613:Locava Backendv2/src/lib/posts/post-envelope.ts
  try {
    if (isBackendAppPostV2ResponsesEnabled()) {
      const rawForApp = { ...sourcePost, id: resolvedPostId, postId: resolvedPostId } as Record<string, unknown>;
      envelope.appPost = toAppPostV2FromAny(rawForApp, {
        postId: resolvedPostId,
        viewerState: {
          liked: viewer.liked,
          saved: viewer.saved,
          savedCollectionIds: [],
          followsAuthor: false
        }
      }) as unknown as PostRecord;
      envelope.postContractVersion = 2;
    }
```

**For You path (correct projection helper)**

```269:273:Locava Backendv2/src/services/surfaces/feed-for-you.service.ts
function toPostCard(candidate: ForYouCandidate, idx: number, requestId: string): FeedCardDTO {
  return toFeedCardDTO({
    postId: candidate.postId,
    sourceRawPost: candidate.rawFirestore,
    rankToken: `fy:${requestId.slice(0, 8)}:${idx + 1}`,
```

---

## 3. Native surface inventory

| Surface | File(s) / component | Data source | `appPost` / `appPostV2` available? | Used? | Carousel: `getPostMediaAssets` | Cover/tile: `getPostCover` / `getHeroUri` | Activities: `getPostActivities` | Video: `getPostPlaybackUrls` | Cache / optimistic | Risk | Grep / evidence |
|---------|---------------------|-------------|-------------------------------------|--------|-------------------------------|--------------------------------------------|----------------------------------|------------------------------|-------------------|------|-------------------|
| For You feed | `features/home/**`, `feedV2.normalize.ts` | Backend for-you DTO | Often yes on DTO | Partial — normalizer maps cover from `appPost` when flag on | Via liftable when opened | `getPostCoverDisplayUri` in normalize | Mixed | Mixed | Feed cache | **P1** if home tab still uses bootstrap | `feedV2.normalize.ts`, `warnAppPostV2InDev` |
| Explore / following home (bootstrap/page) | Same + orchestrated responses | `/v2/feed/bootstrap` `/v2/feed/page` | **Often no** (backend strip) | Native falls back to legacy | `AssetCarouselOnly` uses `getPostMediaAssetsFromRecord` | `getHeroUri` legacy branch | `getPostActivities` | `getPostPlaybackUrlsFromAsset` | merge helpers | **P0/P1** wire missing `appPost` | `getHeroUri.ts` lines preferring wire then legacy |
| Liftable viewer | `LiftableViewerHost.heavy.tsx`, `AssetCarouselOnly.tsx` | Merged post record | After batch hydrate | **Yes** in carousel path | **Yes** | Letterbox helpers | Partial in host | **Yes** in carousel | `liftablePrecache.ts` | **P1** precache uses `post.assets` | `getPostMediaAssetsFromRecord(full)` |
| Post tile grid | `PostTile.tsx` | Tile post | If present on record | **Partial** — video/image from `assets[0]` + legacy thumbs | N/A (tile) | legacy `displayPhotoLink` / `thumbUrl` | N/A | partial | merge | **legacy_source_of_truth_risk** | `PostTile.tsx` `firstAssetTypeForTile` |
| Profile grid | `profile/**`, `profileV2.normalize.ts` | Grid API | Often yes when backend enriches | Partial | open → liftable | mixed | mixed | mixed | profile store | **P1** | `profileV2.normalize.ts` |
| Search home cards | `SearchHomeSurface.tsx` | Bootstrap rows | Rows may include wire | **Yes** for cover thumb when normalized | — | `getPostCoverDisplayUri` | — | — | — | **app_post_consumer_partial** | `normalizeAppPostV2(row.appPostV2 ?? row.appPost)` |
| Search results list | `searchResultsSurface.tsx` | `/v2/search/results` | Depends on backend | `getHeroUri` only for thumb | open → liftable | **getHeroUri** | — | — | — | **P1** hero only | `getHeroUri(p)` |
| Mixes shelf / feed | `ActivityMixesShelf.tsx`, `mixPostMedia.ts` | Mix cards | Partial | **mixPostMedia** uses AppPostV2 when wire present | **Yes** in `mixPostMedia` | cover from AppPost | legacy fallback on shelf | playback helper | — | **P1** shelf still reads `thumbUrl` / `displayPhotoLink` | grep `thumbUrlsFromPosts` |
| Collections | `CollectionDetail.heavy.tsx` | Batch posts | Yes when backend sends | **Yes** for carousel mapping | **Yes** | **Yes** | falls back to `post.activities` | via `mixPostMedia` pattern | local | **P1** activities fallback | lines 178–179 |
| Notifications list | `Notifications.heavy.tsx` | `/v2/notifications` | On nested `post` when present | **Partial** — cover via `normalizeAppPostV2` | N/A | **Yes** for preview image | — | — | local | **P1** preview thumb vs `post` | `normalizeAppPostV2(postRecord?.appPostV2 ?? postRecord?.appPost)` |
| Chat message bubble | `MessageBubble.tsx`, `MessageContextMenu.tsx` | Thread payload | varies | `getHeroUri` for preview | open viewer | **getHeroUri** | — | — | — | **detail_hydration_risk** if open without batch | `MessageContextMenu.tsx` |
| Map / markers | map feature modules | map endpoints | compact | marker UX | hydrate on open | marker thumb | — | — | — | **cover_only_tile_ok** + hydrate | map grep hits |
| Posting / after post | `directPostUploadClient.ts`, continuity | finalize response | finalize includes `appPost` | client merges `appPostV2` | logging only | — | — | — | **optimistic_cache_risk** | `mergePostPreserveRichFields.ts` |
| Deep links / share | branch / link handlers (search `deep link` in native inventory) | varies | varies | **needs_manual_review** per build | — | — | — | — | — | **P1** | inventory JSON `"deep link"` hits |

---

## 4. Critical risk list (ranked)

### P0 — wrong media, duplicates, crashes, wrong post

1. **Home feed bootstrap/page JSON omits `appPost` / `postContractVersion`** while repository builds them — native cannot prefer canonical contract on primary home tabs without re-deriving from partial legacy shell (carousel / dots divergence risk).
2. **Detail / batch orchestration** (`posts-detail.orchestrator.ts`) — tests explicitly describe `post_card_cache` upgrades and `mediaCompleteness: cover_only`; wrong hydration mode can yield **cover-only viewer** or stale assets until Firestore upgrade (behavior exists by design; mis-wiring is P0).

### P1 — wrong activities, stale media, optimistic mismatch

1. **Native precache / prefetch** (`liftablePrecache.ts`, `mediaPrefetchCoordinator.ts`) — `post.assets` / `assets[0]` for first carousel URI; can diverge from `getPostMediaAssets` if embedded `appPost` is missing or stale.
2. **Mixes `mapPostCard`** (backend) — poster/playback resolved from legacy top-level fields.
3. **Collections / notifications / search results** — mixed canonical + legacy fallbacks for activities or thumbs.
4. **`getHeroUri`** — intentional legacy fallback chain; risky when `appPost` absent (see P0).

### P2 — cleanup / legacy references

- Broad `photoLink` / `displayPhotoLink` / `thumbUrl` references in contracts, compat mappers, and tests (`backend-inventory` pattern counts: `displayPhotoLink` 166 line hits, `posterUrl` 349, `thumbUrl` 244 — many are legitimate compatibility layers).

---

## 5. Source-of-truth rules (target architecture)

1. **Firestore new docs:** Master Post V2 (`locava.post`, version 2, canonical sections).
2. **Backend JSON toward the app:** Prefer **`appPost` (`locava.appPost` v2) + `postContractVersion: 2`** on every post card where payload budget allows; marker/slim endpoints may remain cover-only but must expose **`mediaCompleteness` + `requiresAssetHydration`** consistently.
3. **Native display:** **`normalizeAppPostV2`** → **`getPostMediaAssets` / `getPostCoverDisplayUri` / `getPostActivities` / `getPostPlaybackUrlsFromAsset`** for viewer and carousel; legacy top-level fields **compat only**.
4. **Full viewer:** Carousel item array **`getPostMediaAssets` (or `getPostMediaAssetsFromRecord` with full post)** only — no ad-hoc append of poster URL as an extra slide (dedupe logic lives in `getPostMediaAssets.ts` — audit only, do not change).
5. **Pagination dots:** Same array length as carousel media items derived from the same helper (native: verify `AssetCarouselOnly` / host agree on length; precache must not invent extra URIs as slides).
6. **Activities:** `classification.activities` via **`getPostActivities`**; top-level `activities` **fallback only**.
7. **Video:** **`getPostPlaybackUrlsFromAsset`** (or explicit `appPost` playback object) — do not treat poster image as a second video slide.

---

## 6. Open questions / unknowns

1. **Exact native entry tab** for logged-in home: if production still uses **for-you only**, P0 severity for bootstrap strip is reduced; if **explore** uses bootstrap/page, P0 stands. (Confirm via feature flags / navigation tree — not resolved in this grep-only audit.)
2. **Legacy post IDs** for old multi-image / old video fixtures in prod — use Firestore lookup or QA sheet (see §7 placeholders).
3. **`GET /v2/search/home/v1`** — lower traffic; needs contract read in a follow-up pass (listed as manual review).

---

## 7. Fixture matrix (required test posts)

| # | Fixture | Expected raw `assets[]` count (indicative) | Canonical `media.assetCount` | `appPost.media.assets` count | Carousel slides (viewer) | Activities | Video readiness | Engagement |
|---|---------|---------------------------------------------|-------------------------------|------------------------------|----------------------------|--------------|-------------------|------------|
| 1 | `post_6890aeea764bc3ab` (single-image MPV2) | 1 | 1 | 1 | 1 | from classification | N/A | from `engagement` / route |
| 2 | `post_92a8f2a283c9a64a` (single-video MPV2, if still live) | 1 | 1 | 1 | 1 (+ poster as poster, not slide) | … | playable when variants exist | … |
| 3 | Latest two-image MPV2 | 2 | 2 | 2 | 2 | … | N/A | … |
| 4 | Old multi-image legacy | ≥2 | recovered via normalization | normalized len | legacy dedupe rules | legacy + recovered | varies | legacy counts |
| 5 | Old video legacy | ≥1 | recovered | normalized | poster + playback rules | varies | partial / `processing` paths | varies |
| 6 | `jlDJFsYgGca9v8pofbFL` (embedded comments) | varies | varies | varies | comments do not add slides | N/A | N/A | embedded preview behavior |
| 7 | `post_32705f058364cbde` (partial / playable video) | ≥1 | ≥1 | ≥1 | must not invent fake variants | … | **processing-but-playable** | … |

*Rows 4–5 IDs:* not verified in repo — **fill from existing tests** (`toAppPostV2.test.ts`, `post-envelope.test.ts`, `posts-detail.orchestrator.test.ts`) or QA.

---

## 8. Critical correctness checks (per surface)

| Check | Backend | Native |
|-------|---------|--------|
| Full viewer all assets | `POST /v2/posts/details:batch` `hydrationMode: full` + Firestore upgrade paths in `posts-detail.orchestrator.ts` | `AssetCarouselOnly` + `getPostMediaAssetsFromRecord` |
| Tile cover-only | Envelope marks `mediaCompleteness` / `requiresAssetHydration` | `PostTile` / `getHeroUri` |
| Poster not duplicated as slide | `toAppPostV2` / normalization (audit only) | Dedupe in `getPostMediaAssets.ts` |
| Cached vs server asset count | `globalCache` + `entityCacheKeys.postCard` + feed page cache | `mergePostPreserveRichFields` / `mergePostMedia` |
| Optimistic post stale | finalize returns `appPost` — see `directPostUploadClient.ts` logs shape | `mergePostPreserveRichFields.test.ts` documents expectations |
| Detail hydration | Batch contract supports `open` / `full` / `playback` | Liftable open should call batch (verify in native trace) |
| Activities | `buildPostEnvelope` / classification | `getPostActivities.ts` |
| Video | `post-envelope` + detail orchestrator playback selection | `getPostPlaybackUrlsFromAsset` |
| Engagement counts | `social` / `counts` on cards; detail merges | read from merged post + UI counters |
| Legacy fields | compatibility on `PostCardSummarySchema` | `normalizeAppPostV2` reads legacy when needed |

---

## 9. Acceptance criteria mapping

| Criterion | Status |
|-----------|--------|
| Every **major** backend post-returning route listed | **Met** (§2 table + legacy/proxy) |
| Every **major** native post-rendering surface listed | **Met** (§3 table; deep link left as flag-dependent) |
| Every direct legacy media field usage classified or flagged | **Met** via inventories + §4; exhaustive per-line review is in JSON hits |
| Every carousel/dot/media builder identified | **Met** (`AssetCarouselOnly`, `mixPostMedia`, `postMediaNormalizer`, `liftablePrecache`, coordinator) |
| Every post cache/store touching media identified | **Met** (`globalCache` feed keys, `entityCacheKeys.postCard`, `mixCache`, native LRU / continuity) |
| Every posting/optimistic path identified | **Met** (`directPostUploadClient`, `mergePostPreserveRichFields`) |
| Audit tells where to fix next **without applying fixes** | **Met** (§4 + route table follow-up column) |

---

## 10. Recommended next fixes (do not implement in this pass)

1. Include `appPost` and `postContractVersion` (and any existing `rawFirestoreAssetCount` / `mediaCompleteness` fields needed by the client) in **`feed-bootstrap` and `feed-page` orchestrator item maps**, or replace explicit maps with controlled spreads from `PostCardSummarySchema` picklist.
2. Backend **mixes `mapPostCard`**: prefer `toAppPostV2FromAny` when raw post blob is available; use `appPost.media.cover` for poster.
3. Native: route **precache** through the same URI derivation as **`getPostMediaAssetsFromRecord`** (or ensure post object always carries embedded `appPost` before precache runs).
4. Normalize **notification list preview** thumb to `getPostCoverDisplayUri(appPost)` when `post.appPost` exists.
5. Chat shared post: ensure thread payload uses **`toAppChatSharedPostV2`** (backend) and native renders from embedded `appPost`.

---

## 11. Phase 10 — final output checklist

1. **Audit doc path:** `Locava Backendv2/docs/audits/full-post-surface-app-post-v2-audit-2026-05-04.md`
2. **Backend inventory JSON:** `Locava Backendv2/docs/audits/full-post-surface-backend-inventory-2026-05-04.json`
3. **Native inventory JSON:** `Locava Backendv2/docs/audits/full-post-surface-native-inventory-2026-05-04.json`
4. **Backend hits scanned:** **2280** line matches
5. **Native hits scanned:** **4172** line matches
6. **P0 risks:** Feed bootstrap/page drops `appPost`; detail/batch wrong hydration can yield incomplete viewer
7. **P1 risks:** precache/carousel URI mismatch; mixes poster legacy path; mixed activities/thumbs; `getHeroUri` without wire `appPost`
8. **Surfaces confirmed correct (when wire + flag present):** For You DTO path (`toFeedCardDTO`); `AssetCarouselOnly` + `getPostMediaAssets`; much of **`mixPostMedia`** / **`CollectionDetail.heavy`** when `appPost` present; **`SearchHomeSurface`** cover path
9. **Surfaces needing follow-up:** Home bootstrap/page wire; chat shared post payload; mixes mapPostCard; notification preview thumb; deep link handlers; search-home-v1
10. **Product behavior unchanged:** **Confirmed** — only new/edited audit artifacts: this markdown, two JSON inventories, one summary markdown, `scripts/audits/full-post-surface-inventory.mts`, and `package.json` script entry `audit:post-surfaces`.
