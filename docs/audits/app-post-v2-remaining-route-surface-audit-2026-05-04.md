# App Post V2 — remaining route/surface audit — 2026-05-04

Purpose: classify **legacy post/media field usage** and bespoke JSON paths after the foundation pass and the **mechanical continuation** on profile / for-you-simple / surface-compare.

## Machine-generated appendix (exhaustive grep hits)

Every legacy-pattern hit under Backend V2 `src/` + `scripts/` and Native `src/` is listed in:

**[`app-post-v2-grep-inventory-2026-05-04.md`](./app-post-v2-grep-inventory-2026-05-04.md)** (regenerate: `npm run audit:app-post-v2-grep` in `Locava Backendv2`).

Heuristic **classification** in that file is automated; use it with the table below. **needs_migration** rows should be triaged to B/C/D in this document or in code.

---

Classification legend:

- **A — Migrated via envelope/card**: response includes `appPost` / `postContractVersion` through `buildPostEnvelope` or `toFeedCardDTO` when `BACKEND_APP_POST_V2_RESPONSES` is on.
- **B — Migrated in continuation (2026-05-04)**: explicit `rawFirestore` / `sourceRawPost` + shared helpers (`enrichAppPostV2Response.ts`) and/or batch `hydrateAppPostsViewerState`.
- **C — Intentional compatibility-only**: legacy aliases (`photoLink`, `displayPhotoLink`, `thumbUrl`, …) derived from contracts/DTOs for old clients; **not** source of truth.
- **D — Still needs follow-up**: bespoke shaping without guaranteed `appPost`; requires route-specific wiring or proxy documentation.

---

## Backend inventory (curated; see grep appendix for every hit)

| Area / file | Pattern | Classification | Notes |
|-------------|---------|----------------|-------|
| `post-envelope.ts`, `compact-surface-dto.ts` | `attachAppPostToFeedCard`, `buildPostEnvelope` | **A** | Canonical attachment path. |
| `feed.repository.ts`, map adapters | `buildPostEnvelope` | **A** | Feed/map markers use envelope when enabled. |
| `chats.repository.ts` `listThreadMessages` | `loadPostCardSummaryBatch` | **A** | Shared post cards come from feed postcards (envelope + card DTO path). |
| `notifications.repository.ts` list page | `notificationFeedService.loadPostCardSummaryBatch` + `post:` on item | **A** for full card | **`preview.thumbUrl`** remains **C** (metadata string). |
| `profile-grid.orchestrator.ts`, `profile-bootstrap.orchestrator.ts` | grid items | **B** | `mapPostDocToGridPreview` now includes `rawFirestore`; `enrichGridPreviewItemsWithAppPostV2` attaches `appPost` + batch viewer hydration. Cache keys bumped (`profile-grid-page-v3`, `profile-grid-preview-v2`). |
| `profile-post-detail.orchestrator.ts` + adapter/repo | post detail `firstRender.post` | **B** | Firestore path adds `sourceRawPost`; seeded path adds synthetic `sourceRawPost`; `attachAppPostV2ToRecord` + `batchHydrateAppPostsOnRecords`. Contract: `firstRender.post` **`.passthrough()`** for `appPost` fields. |
| `feed-for-you-simple.service.ts` + repository | `SimpleFeedCandidate` | **B** | `rawFirestore` on candidate; `toFeedCardDTO({ sourceRawPost })`; batch hydrate on returned cards. |
| `routes/debug/app-post-v2-surface.routes.ts` | surface compare | **B** (tooling) | Optional `?viewerId=` hydrates viewer state; rows include `postContractVersion`, `viewerState`, `legacyCompat`, cover warning. |
| `routes/v2/map-markers.routes.ts` | `displayPhotoLink` on marker payload | **A** + **C** | Envelope built via `buildPostEnvelope`; extra marker fields are compat aliases. |
| `routes/v2/collections-v2.routes.ts` | `displayPhotoLink` in helpers | **A** + **C** | Uses `buildPostEnvelope` for posts; helper strings for thumbnails/collection covers are compat. |
| `search-discovery.service.ts` | `DiscoveryPost.rawFirestore` | **B** | Full Firestore snapshot on each discovery post for `toAppPostV2FromAny`. |
| `routes/v2/search-discovery.routes.ts` | bootstrap / live / mixes prewarm+previews | **B** | `attachAppPostV2ToSearchDiscoveryRow` on compact rows; `batchHydrateSearchDiscoveryPayload` on bootstrap; search bootstrap cache key includes **viewerId**; `/v2/search/live` uses **committed** `/v2/search/results` posts (`sections.posts.items` or `items`) without double-mapping envelopes; discovery fallback still uses `postToSearchRow`; legacy live + all branches batch-hydrate. |
| `searchMixes.orchestrator.ts` `feedPage` | mix feed cards | **A** + **B** | `toSearchMixPreviewDTO` + `sourceRawPost`; batch `hydrateAppPostsViewerState` via `batchHydrateAppPostsOnRecords`. |
| `routes/compat/legacy-api-stubs.routes.ts`, `legacy-reels-near-me.routes.ts` | broad legacy field reads | **D** / proxy | Compat layer: attach `appPost` only where handler owns JSON; pure proxies must stay documented as **D**. |
| `routes/debug/post-rebuilder.routes.ts` | `compatibility.photoLink` checks | **C** | Debug validation of normalized canonical compat fields. |
| Tests (`*.routes.test.ts`) | fixture `displayPhotoLink` | **C** | Synthetic Firestore/doc shapes for tests. |

---

## Native (`Locava-Native`)

**Liftable hero / tiles:** `getHeroUri` now prefers **`appPost` / `appPostV2`** via `normalizeAppPostV2` + `getPostCoverDisplayUri`, then legacy fields. **`LiftableViewerHost.heavy`** validation snapshot uses `getHeroUri` for `hasPoster` (single canonical path).

Remaining surfaces (map bottom sheet, search cards UI, chat bubble, notifications preview, etc.): still migrate incrementally; grep appendix tracks **`needs_migration`** hits — prefer shared AppPostV2 helpers over direct `photoLink` / `assets[0]`.

---

## Recommendation

- **One-post Master Post V2 writes:** still **conditional** — expand QA using `/debug/app-post-v2/surface-compare/:postId` (with `?viewerId=` ) and profile/for-you-simple payloads under the flag.
- **Mass migrate Firestore posts:** **No** — until **D** routes/surfaces are eliminated or documented as proxy-only.
