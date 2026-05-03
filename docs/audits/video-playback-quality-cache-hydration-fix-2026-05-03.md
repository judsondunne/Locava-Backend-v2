# Video playback quality / cache / hydration fix — 2026-05-03

## Root cause

1. **`playbackUrlPresent` drifted from “has a usable HTTPS URL”** — `buildPostMediaReadiness` equated presence with **`productionPlaybackSelected`**, while **`productionPlaybackSelected` excluded originals** (`original` / `fallback_original`). Detail logs could show **`playbackUrl`/original URLs in `assets`** yet **`playbackUrlPresent: false`**.

2. **Original / root MP4 was suppressed during `videoProcessingStatus: "processing"`** — **`allowFallbackAsCanonicalPlayback`** only allowed originals when **`assetsReady`/`completed`/empty status, but not `"processing"`**, so many in-flight uploads never promoted a verified Wasabi/original MP4 to **`playbackUrl`**.

3. **Batch prefetch over-read Firestore** — **`playbackBatchShouldFetchFirestoreDetail`** returned **`true` whenever `!assetsReady`**, even when **`main720`/original/HLS** was already on the playback shell → unnecessary **`loadPostDetail`** work on **`hydrationMode=playback`**.

4. **Stale cache vs ladders** remains preview-driven until **`isPreviewOnly`**, unchanged; capped Firestore upgrades prevent runaway reads.

5. **Native `resolvePlayableMedia`** treated **`mediaStatus: "processing"`** as blocking before scanning variants unless **`explicitFallbackVideoUrl`** path fired, **and skipped top-level **`playbackUrl`****. It did not prefer server-resolved **`playbackUrl`** reliably; **locals must remain first**.

## Resolver priority (`selectBestVideoPlaybackAsset` / `resolveBestVideoPlaybackMedia`)

Default ladder (**`preferHlsFirst`** omitted or `true`; pass **`preferHlsFirst: false`** for legacy MP4-first):

1. **HLS** (`hls`), then **startup** faststart ladders, **`main1080*`, `main720*`** (AVC-before-HEVC rules preserved).
2. **Preview ladder** (**`preview360*`) — only when allowed and nothing better matched.
3. **Original MP4 / asset.original** — always eligible when HTTPS ( **`allowFallbackAsCanonicalPlayback` unconditional** ).
4. **Post-level **`playbackUrl`/`videoUrl`/`media`/`media.video`** fallbacks**.

**`fallbackVideoUrl`**: distinct **`original`** when different from **`playbackUrl`**.

**`productionPlaybackSelected`**: **`true`** when **`playbackUrl`** exists and **`!isPreviewOnly`** (includes originals and post-level playback).

**`playbackUrlPresent` (readiness)**: **`true`** iff **`playbackUrl`** is set (preview-only counts as present but **`isDegradedVideo`**).

## Files changed

**Backend**

- `src/lib/posts/video-playback-selection.ts` — canonical resolver: HLS-first default, originals while processing, nested **`media`/`media.video`**, **`SelectedCanonicalVideoVariant`**, **`resolveBestVideoPlaybackMedia`**, batch gate (**no `assetsReady`** blanket fetch).
- `src/lib/posts/media-readiness.ts` — **`playbackUrlPresent`** / **`playbackReady`** align with playable URL + **`instantPlaybackReady`**; **`processingButPlayable`**; **`preferHlsFirst`** passthrough.
- `src/orchestration/surfaces/posts-detail.orchestrator.ts` — **`LOCAVA_BATCH_PLAYBACK_SOURCE_READ_CAP`** (default **3**) for **`hydrationMode=playback`** batch; **`debugReads`** accumulation; richer **dev** **`posts.batch`** / **`post.detail`** logs.
- `src/observability/feed-items-media-trace.ts` — **`rollupFeedVideoMediaSummary`**: **`videoSelectedVariantCounts`**, **`videoDegradedCount`**, **`videoMissingPlayableCount`**.
- `src/services/surfaces/feed-for-you-simple.service.ts` — **`playbackReady`** includes **`instantPlaybackReady`** like resolver.
- Tests: **`video-playback-selection.test.ts`**, **`media-readiness.test.ts`**, **`post-envelope.test.ts`**, **`posts-detail.orchestrator.test.ts`**, **`feed-items-media-trace.test.ts`**.

**Native**

- `Locava-Native/src/features/posts/postEnvelope.ts` — **`resolvePlayableMedia`**: local-first, then **`playbackUrl`**, **`fallbackVideoUrl`**, then variant ladder; **HLS before MP4 startups** in **`REMOTE_VIDEO_VARIANT_ORDER`**; **`processing`** no longer blocks when canonical URLs exist.

## Tests added / updated

- Representative docs **A–F** cases in **`video-playback-selection.test.ts`** (**HLS vs ladders**, **`main720` only**, **`processing` + original**, **`preview360` vs `main720`, image untouched**).
- **`playbackBatchShouldFetchFirestoreDetail`**: ladder without fetch; preview-only triggers fetch.
- **`post.detail`** orchestrator: processing videos still **`playbackReady`/`playbackUrlPresent`** with original.
- **`post-envelope`** selection expects **HLS** when **`master.m3u8`** exists beside **`main1080Avc`**.
- Native: **`tsx`** **`postEnvelope.test.ts`**, **`resolvePostMediaSource.test.ts`**, **`mixPostMedia.test.ts`**, **`postCanonical.test.ts`**.

### Case **H** (bounded reads)

- **`LOCAVA_BATCH_PLAYBACK_SOURCE_READ_CAP`** clamps **`loadPostDetail`** calls per **playback** batch (default **3**). Coverage is via behavior in **`runBatchLightweight`** and logs **`playbackFirestoreReadsPerformed`** / **`playbackFirestoreReadCap`**; no unbounded **`N`** detail reads beyond cap.

## Before / after (log sketches)

**Before:** `posts.detail` / readiness: **`playbackReady: false`**, **`playbackUrlPresent: false`**, while **`playbackUrl`/original present in diagnostics**.

**After (dev):**

```text
playbackReady: true
playbackUrlPresent: true
selectedVideoVariant: "original"
processingButPlayable: true
```

**Feed summary (`rollupFeedVideoMediaSummary`):**

```text
videoSelectedVariantCounts: { hls: n1, main1080: n2, main720: n3, original: n4, preview360: n5, none: n6 }
videoDegradedCount, videoMissingPlayableCount
```

## Performance impact

- **Fewer Firestore **`loadPostDetail`** calls** on **`details:batch` playback** when non-preview playable URLs exist on the shell (**`assetsReady` gate removed from batch heuristic**).
- **Hard cap** on source reads per batch (`LOCAVA_BATCH_PLAYBACK_SOURCE_READ_CAP`).
- Resolver runs in-memory only (existing pattern); rollup adds **`O(video items)` resolver calls** matching feed size (**no Firestore/network**).

## Manual / deploy checks

- Env: **`LOCAVA_BATCH_PLAYBACK_SOURCE_READ_CAP`** (optional, default **3**).
- Probes:
  - `GET /v2/feed/for-you/simple?limit=5`
  - `POST /v2/posts/details:batch` with **`hydrationMode=playback`**
  - `GET /v2/posts/:id/detail` for **`videoProcessingStatus=processing`** with original MP4
- Confirm no **`playbackUrlPresent: false`** for posts with **`playbackUrl`** in readiness.
- Run **`npm run typecheck`** in **`Locava Backendv2`**; **`npx vitest run`** targeted suites above.
