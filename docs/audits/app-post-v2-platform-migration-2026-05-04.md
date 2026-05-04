# App Post V2 platform migration audit — 2026-05-04

## Summary

Introduced the **App Post V2** contract (`locava.appPost` v2), a single backend converter (`toAppPostV2FromAny`), projections, batch viewer-state hydration, debug surface comparison, and wired **`appPost` + `postContractVersion`** into:

- Any response built via **`buildPostEnvelope`** (feed bootstrap/page candidates, map markers, collections envelopes, feed detail adapter, search envelopes, etc.).
- **`toFeedCardDTO`** / **`toSearchMixPreviewDTO`** (including For You via `sourceRawPost` → `rawFirestore` on `ForYouCandidate`).

Native: added **`src/contracts/appPostV2.ts`**, **`src/features/posts/appPostV2/*`** helpers and thin media primitives, and **`feedV2.normalize`** now attaches **`appPostV2`** and can prefer **`media.cover`** for poster when **`EXPO_PUBLIC_NATIVE_APP_POST_V2_CONSUMER`** is not disabled. **`getHeroUri`** (liftable / tiles) now prefers **`appPost` / `appPostV2` + `getPostCoverDisplayUri`** before legacy `displayPhotoLink` / `assets[0]`.

This audit documents what was **implemented in this pass**, what **still requires route-by-route completion**, and how to verify.

---

## Backend routes — status

### Fully covered indirectly (postcard / envelope surfaces)

Any route that already returns items produced by **`buildPostEnvelope`** or **`toFeedCardDTO`** now includes **`appPost`** when `BACKEND_APP_POST_V2_RESPONSES` is enabled (default **true**; set to `0`/`false` to disable).

Known call sites for **`buildPostEnvelope`** (grep): `feed.repository`, `feed-detail-firestore.adapter`, `map.repository`, `map-markers-firestore.adapter`, `map-markers.routes`, `collections-v2.routes`, `search.service`.

### Mechanical continuation (2026-05-04 — backend)

Wired **without extra Firestore reads per grid cell**:

- **`/v2/profiles/:userId/grid`**: grid preview docs expose `rawFirestore`; **`enrichGridPreviewItemsWithAppPostV2`** attaches **`appPost`** + **`postContractVersion: 2`** and batch **`hydrateAppPostsViewerState`** (cache key **`profile-grid-page-v3`**).
- **`/v2/profiles/:userId/bootstrap`**: same enrichment on `gridPreview.items` (preview cache **`profile-grid-preview-v2`**).
- **`/v2/profiles/:userId/posts/:postId/detail`**: Firestore adapter returns **`sourceRawPost`**; orchestrator attaches **`appPost`** + batch hydrate; response post object uses **`.passthrough()`** for extra keys.
- **`/v2/feed/for-you/simple`**: candidates carry **`rawFirestore`**; **`toFeedCardDTO({ sourceRawPost })`** + batch hydrate on cards.

Shared helper: **`src/lib/posts/app-post-v2/enrichAppPostV2Response.ts`**.

Debug **`GET /debug/app-post-v2/surface-compare/:postId`** now supports **`?viewerId=`** for viewer hydration and returns richer projection rows (**`viewerState`**, **`legacyCompat`**, **`postContractVersion`** per row).

### Search / mixes continuation (this session)

- **`SearchDiscoveryService`**: `DiscoveryPost.rawFirestore`; **`postToSearchRow`** uses **`attachAppPostV2ToSearchDiscoveryRow`**.
- **`GET /v2/search/bootstrap`**: cache key includes **viewerId**; **`batchHydrateSearchDiscoveryPayload`** after build.
- **`/v2/mixes/prewarm`**, **`/v2/mixes/previews`**: posts mapped with **`service.postToSearchRow`** + batch hydrate.
- **`searchMixes.orchestrator` `feedPage`**: mix feed DTOs get **`sourceRawPost`** on the compact seed + batch hydrate.
- **`POST /v2/search/live`**: uses committed **`/v2/search/results`** post cards when available (**`sections.posts.items`** / **`items`**); no double-mapping of envelopes; discovery fallback + legacy live paths batch-hydrate.

**Exhaustive grep + classifications:** `docs/audits/app-post-v2-grep-inventory-2026-05-04.md` (`npm run audit:app-post-v2-grep`).

### Still needs explicit review / compat-only

- **Native** map bottom sheet, search list UI, chat bubble, notification row UI: grep appendix **`needs_migration`** (see below).
- **`/api/v1/product/*`** and **legacy stubs** — often proxies or shim JSON; classify per handler (**do not** claim migrated unless transform owns the payload).
- **`/v2/chats/*`** shared posts: postcard summarized via **`loadPostCardSummaryBatch`** (**envelope path**); confirm all inbox/thread variants.
- **`/v2/notifications/*`**: **`post`** postcard uses feed batch; **`preview.thumbUrl`** remains a **compat** string.

**Action:** For each remaining handler, ensure either (a) `toAppPostV2FromAny(raw)` is attached as `appPost`, or (b) an explicit projection helper from **`toAppPostCardV2`** / **`toAppMapMarkerPostV2`** / etc. is returned.

---

## Native surfaces — status

| Surface | Status |
|--------|--------|
| Home feed normalize (`feedV2.normalize`) | **Migrated**: reads `item.appPost`, stores `appPostV2`, optional cover-first poster |
| `getHeroUri` (liftable hero + tile thumbnails) | **Migrated**: prefers `appPost` / `appPostV2` + `getPostCoverDisplayUri`, then legacy |
| Liftable full carousel, map, search UI, profile tiles, chat, notifications | **Partial / follow-up** — use grep inventory **`needs_migration`**; consume `appPostV2` in each surface |

---

## Old fields referenced (and why)

| Field | Role |
|-------|------|
| `photoLink`, `photoLinks2`, `photoLinks3`, `displayPhotoLink` | Still emitted under **`appPost.compatibility`** and legacy postcard fields for rollout |
| `assets[0]` in `feedV2.normalize` | Legacy fallback for preview/mp4 until all surfaces read **`appPostV2.media.assets`** |
| `normalizeAssets` only keeping 1 asset in For You repo | **Pre-existing** slimming; **`appPost`** now uses **full** `rawFirestore` for canonical multi-asset |

---

## Feature flags

| Flag | Where |
|------|--------|
| `BACKEND_APP_POST_V2_RESPONSES` | Backend env (Zod default **true**); `0`/`false` omits `appPost` on envelopes / feed cards |
| `EXPO_PUBLIC_NATIVE_APP_POST_V2_CONSUMER` | Native; `0`/`false` skips cover-first preference from `appPost` |

---

## Test commands

```bash
cd "Locava Backendv2"
npm run typecheck
npx vitest run src/lib/posts/app-post-v2/toAppPostV2.test.ts
npx vitest run src/lib/posts/post-envelope.test.ts
npx vitest run src/services/surfaces/feed-for-you.service.test.ts
```

Debug:

- `GET /debug/app-post-v2/surface-compare/:postId` — enabled when `NODE_ENV !== "production"` **or** `ENABLE_POST_REBUILDER_DEBUG_ROUTES=true`. Optional query: **`viewerId`** (hydrates **`viewerState`** via batch hydration).

---

## Manual QA checklist (from spec)

Use backend responses with `appPost.media.assets[]` populated.

**Home:** for-you video + multi-image; radius/nearby; following.

**Search:** multi-image result; mix feed video; card cover.

**Collections:** multi-image detail; saved preview.

**Profile:** own/other grid; post detail.

**Map:** marker preview; bottom sheet tile; open viewer.

**Notifications:** like/comment open + preview parity.

**Chat:** shared bubble; tap to viewer; video URL; multi-image.

**Viewer:** liftable host; carousel count vs backend; no duplicate first asset; HQ video when available; counts parity.

---

## Firestore canonical writes

**Safe to start writing Master Post V2 canonical fields to Firestore when:**

- Product/backfill pipeline validates **`validateMasterPostV2`** on write previews, and
- Clients in production consume **`appPost`** for media (this rollout is in progress).

**Do not** mass-migrate legacy docs or delete legacy fields as part of this task.

---

## Files changed (this session)

### Backend (representative)

- `src/contracts/app-post-v2.contract.ts`
- `src/lib/posts/app-post-v2/toAppPostV2.ts`
- `src/lib/posts/app-post-v2/hydrateAppPostViewerState.ts`
- `src/lib/posts/app-post-v2/flags.ts`
- `src/lib/posts/app-post-v2/toAppPostV2.test.ts`
- `src/lib/posts/post-envelope.ts`
- `src/dto/compact-surface-dto.ts`
- `src/contracts/entities/post-entities.contract.ts`
- `src/config/env.ts`
- `src/repositories/surfaces/feed-for-you.repository.ts`
- `src/services/surfaces/feed-for-you.service.ts`
- `src/services/surfaces/feed-for-you.service.test.ts`
- `src/routes/debug/app-post-v2-surface.routes.ts`
- `src/app/createApp.ts`
- `src/observability/config-health.service.test.ts`

### Native

- `src/contracts/appPostV2.ts`
- `src/features/posts/appPostV2/*`
- `src/features/home/reels.types.ts`
- `src/features/home/backendv2/feedV2.types.ts`
- `src/features/home/backendv2/feedV2.normalize.ts`
