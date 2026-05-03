# Video playback quality selection audit — 2026-05-03

## Root cause

1. **`/v2/posts/details:batch` (hydrationMode `playback`)** used `playbackNeedsSourceTruth` that only fired when **poster, playbackUrl, and fallback were all missing**. Any post with a **poster plus a preview-level `playbackUrl`** never loaded Firestore, so the batch stayed on `post_card_cache` / `partial_cached` with **preview360** even when source-of-truth had **main720 / main1080 / HLS**.

2. **Even when `loadPostDetail` ran**, the orchestrator rebuilt the shell with `toPlaybackPostShellDTO(card)` only, **discarding `detail.assets`**, so production variants from the post document never reached the batch payload.

3. **Compact playback shell mapping** could set `asset.original` to the same URL as `previewUrl` and inject **duplicate `main720*` keys** when `mp4Url === previewUrl`, confusing ladder selection. **Alias suppression** in the old `pickProcessedPlaybackUrl` logic then skipped real ladder URLs when they matched the denormalized `original` field.

4. **Native `resolvePlayableMedia`** trusted `playbackReady && playbackUrl` first and labeled the source `main720Avc` regardless of actual tier, so a **low-res `playbackUrl`** could stick even when richer `variants` existed after hydration.

## Files changed (backend)

- `src/lib/posts/video-playback-selection.ts` — canonical `selectBestVideoPlaybackAsset`, `playbackBatchShouldFetchFirestoreDetail`, HEVC deferral, alias / preview / original promotion rules.
- `src/lib/posts/video-playback-selection.test.ts` — unit coverage.
- `src/lib/posts/media-readiness.ts` — delegates to canonical selection; `playbackUrlPresent` / `playbackReady` align with **production** ladder (not preview-only); processing posts omit promoting **original** to `playbackUrl` until allowed.
- `src/orchestration/surfaces/posts-detail.orchestrator.ts` — Firestore fetch when preview-only or missing playable URL; **`mergePlaybackShellFromDetailRecord`** merges **truth `assets`**; optional `LOCAVA_VIDEO_MEDIA_DEBUG=1` diagnostics on batch posts.
- `src/dto/compact-surface-dto.ts` — `assetsReady` from card; avoid fake `main720` when `mp4Url` is the same as `previewUrl`.
- `src/orchestration/surfaces/posts-detail.orchestrator.test.ts` — lightweight path with **production URLs on card**; preview-only upgrade case; cold path cards carry ladder URLs.
- `scripts/debug-video-variant-selection.mts` — CLI inspection of a post doc.
- `package.json` — `debug:video:variant-selection` script.

## Files changed (native)

- `src/features/posts/postEnvelope.ts` — ordered variant resolution (startup → main1080 → main720 → HLS → original → preview); **ranked URLs before** post-level fallback when processing; dev log on merge upgrade.
- `src/features/posts/postHydrationMerge.ts` — `getPlayableVideoUrl` key order aligned with backend.
- `src/features/media/mediaSourcePolicy.ts` — **startup faststart** variants considered before main ladder in `pickMainPair` / `pickMainPairConstrained`.

## Before / after selection behavior

| Scenario | Before | After |
|----------|--------|--------|
| Card has poster + preview only | No Firestore fetch; batch stuck on preview | Fetch detail; merge **truth assets**; **main1080/main720/HLS** when present |
| Detail fetch succeeds | Shell still from card (truth assets dropped) | Shell **video `assets` + `assetsReady`** from detail |
| Ladder URL equals denormalized `original` on shell | Often skipped → preview or wrong tier | **Ladder / preview keys** still selected; alias collapse only when **no distinct transcode** exists |
| Processing post, only `fallbackVideoUrl` | Could expose `playbackUrl` = original early | **`playbackUrl`** omitted until fallback allowed; **`fallbackVideoUrl`** still set |
| Native merge | Trusted `playbackUrl` blindly | **Variant ladder** wins over misleading `playbackUrl` when URLs exist on assets |

**Priority (backend, default universal / AVC-first):** startup faststart (1080→720→540 AVC/non-AVC) → `main1080Avc` → `main1080` (HEVC deferred if AVC sibling) → `main720Avc` → `main720` → `hls` → `original` (only when allowed) → `preview360`. Optional `preferHlsFirst` supported on `buildPostMediaReadiness` options for future clients.

## Cache invalidation / upgrade strategy

- **No global cache disable.** Playback batch performs at most **one `loadPostDetail` per post** when `playbackBatchShouldFetchFirestoreDetail(shell)` is true (preview-only or missing playable/fallback URL).
- **Lightweight path** unchanged when the **card-backed shell already resolves to a production ladder URL**.
- **`assetsReady` on playback shells** now reflects the card unless overwritten by detail merge.

## Tests added

- `video-playback-selection.test.ts` — ladder vs preview, HEVC deferral, alias doc, batch gate, photo post.
- Orchestrator tests — preview-only → detail upgrade; lightweight path with production on card.

## Manual verification

1. `npm run debug:video:variant-selection -- --postId <id>` against: new multi-variant video, processing video, legacy original-only, image post (should show non-video / empty selection as appropriate).
2. `LOCAVA_VIDEO_MEDIA_DEBUG=1` on server; call `POST /v2/posts/details:batch` with `hydrationMode: "playback"` and inspect `selectedVariantLabel`, `productionVariantSelected`, `cacheMediaUpgraded`.
3. Native: dev build — open feed item with preview-first card; after batch/detail merge, confirm **`video_playback_source_change`** log and sharper playback.

## Verification commands

```bash
cd "Locava Backendv2"
npm run typecheck
npx vitest run src/lib/posts/video-playback-selection.test.ts src/lib/posts/media-readiness.test.ts src/orchestration/surfaces/posts-detail.orchestrator.test.ts
npm run debug:video:variant-selection -- --postId "<postId>"
```

Native harness (if desired):

```bash
cd Locava-Native
npx --yes tsx src/features/posts/postHydrationMerge.test.ts
```

## Known limitations

- **HLS-first** is opt-in via `preferHlsFirst` on readiness options; default remains **MP4/AVC-first** for universal playback.
- **Debug diagnostics** on batch responses require `LOCAVA_VIDEO_MEDIA_DEBUG=1` (keeps payloads small in production).
- **`debug:video:variant-selection`** requires live Firestore (`FIRESTORE_SOURCE_ENABLED`); it does not simulate `post_card_cache` thinning (use batch API for that).
