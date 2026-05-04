# First playback priority and full photo-carousel assets (2026-05-03)

## Root causes

### Missing carousel photos on feed-visible posts

`/v2/feed/for-you/simple` mapped full Firestore-derived `candidate.assets`, but **`toFeedCardDTO` defaulted `compactAssetLimit` to `1`**, trimming every postcard to a single asset. Native caches (`setFullPost` / reels full-post cache) and UI therefore saw legitimate multi-photo posts as single-slide posts until a lucky detail hydration.

Playback batch merge had a second bug: **`mergePlaybackShellFromDetailRecord` returned image posts without attaching `detail.assets`**, so even a successful Firestore read could not widen the carousel for non-video shells.

Merge logic could also behave poorly when an authoritative incoming payload reused the “one row” postcard shape: hydration merge paths need to preserve the longer gallery when both sides are photo-only.

### First video startup competing with startup traffic

Cold start schedules achievements `/v2/achievements/bootstrap`, push-token hooks, prefetch batches, and feed-window warms concurrently with the first expo-av load. Scheduler logs already showed multi-route contention; native now **queues non-`p0` `startupSchedule` work** plus **explicit achievements bootstrap** behind a **`firstPlaybackGate`** that releases when the active reel paints a hero photo or the first visible video reaches `isPlaying`, with a bounded timeout fallback.

---

## Mitigations shipped

### Backend

- **`compactAssetLimit: min(12, assetCount)`** on For You postcards so feed JSON carries full (capped) `assets[]` for carousel posts (`feed-for-you-simple.service.ts`, `feed-for-you.service.ts`).
- **Image + video paths share `detail.assets → shell.assets`** inside `mergePlaybackShellFromDetailRecord`.
- Playback batch (**`hydrationMode: playback`**):
  - **Photo carousel upgrade**: first two batch indices may trigger a capped Firestore read when the shell looks like **`mediaType`/assets imply image-only AND `assets.length ≤ 1`**, analogous to degraded video upgrades.
  - Logs: **`POST_MEDIA_FULL_ASSETS_*`**, **`DETAIL_BATCH_SPLIT_VISIBLE_FROM_PREFETCH`**, **`BACKGROUND_ROUTE_DELAYED_DURING_FIRST_PLAYBACK`** (low-priority gate waits).
- **Debug fields** on `GET /v2/feed/for-you/simple?debug=1`: `firstPaintPlaybackReadyCount`, `firstVisiblePlaybackUrlPresent`, `firstVisiblePosterPresent`, `firstVisibleVariant`, `firstVisibleNeedsDetailBeforePlay`.

### Native

- **`pickRicherPostAssetsArray` / `mergePostMediaPreservingFullAssets`** plus wiring in `mergePostPreserveRichFields` and `mergeHydratedPostShell` keeps longer photo galleries authoritative.
- **`firstPlaybackGate` + `startupOrchestration`**: all non-`p0` startup tasks defer until playback or hero-photo paint (`deferWorkUntilFirstPlaybackAllowed`).
- **Achievements** network bootstrap (`bootstrapHero`, `bootstrap`) now runs only after playback gate opens.
- **Prefetch**: `warmReelsFeedWindow` restricts `[-1,0,1,2]` to **`[0]`** while gated (with dev log **`OFFSCREEN_VIDEO_PRELOAD_SKIPPED_DURING_FIRST_PLAYBACK`**).
- **`hydratePostDetailsBatch` caps** (≤1/`open`, ≤2 `prefetch` while gated), dedup keys include **`getFeedHydrationEpoch()`**, tail IDs flush after release.
- **Instrumentation logs**: `[VIDEO_*]`, `[FIRST_PLAYBACK_GATE_*]` family as requested.

---

## Tests run

From `Locava Backendv2` (passed locally):

```bash
npx vitest run src/lib/posts/video-playback-selection.test.ts src/orchestration/surfaces/posts-detail.orchestrator.test.ts
```

From `Locava-Native` (passed locally):

```bash
npx vitest run src/features/posts/mergePostMedia.test.ts
```

---

## Remaining risks

- Photo batch upgrades intentionally fire only for **`batchIndex < 2`** to respect **`LOCAVA_BATCH_PLAYBACK_SOURCE_READ_CAP`**; deeper positions still rely on full feed cards / explicit detail opens.
- `firstPlaybackGate` timeout (`~3.8s`) may release background queues before expo-av reports `isPlaying` on very slow networks—better than starving the app indefinitely, but logs should be watched.
- **`firstPlaybackGate` + global Reels instrumentation flags** persist for the cold session only; navigating away/back does not rewind globals by design (`ReelsFeedHeavy` resets item-render marker on feed identity change).
