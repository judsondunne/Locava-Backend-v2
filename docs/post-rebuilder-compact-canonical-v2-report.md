# Post Rebuilder — compact canonical Master Post V2 (2026-05-05)

## Summary

Live `/posts/{postId}` documents written through the Post Rebuilder use a **single pipeline**: normalize/repair (when needed) → **`compactCanonicalPostForLiveWrite`** → backup (`postCanonicalBackups/{postId}_{timestamp}`) + diagnostics (`postCanonicalDiagnostics/{sameId}`) → **full document replace** with `set(..., { merge: false })` → **re-read** → **`isCompactCanonicalPostV2(savedDoc)`** → **`mediaUrlSanityCheckOnSavedCompactPost(savedDoc)`** (HTTPS primary for video, at least one HTTPS image URL per image asset, cover-like URL for image/video/mixed from `media.cover`, `compatibility`, and top-level `photoLink` / `displayPhotoLink` / `thumbUrl`).

**Structural compact** (`compactOk`) and **playback readiness** (`videoNeedsFaststart` / `mediaNeedsRepair`) are separate: **`evaluatePostRebuildReadiness`** (and **`isCompactCanonicalPostV2`**, which maps `ok` → **`canSkipWrite`**) require **verified fast-start ladder URLs** plus **`readiness.assetsReady` / `instantPlaybackReady` / `faststartVerified`** for every **video** asset on **video** and **mixed** posts. Compact-shaped docs that still use **`fallback_original_or_main`** or missing **`startup720FaststartAvc` / `startup540FaststartAvc`** are **not** “already compact” for skip — they must run **Generate / Optimize** until **`canSkipWrite`** is true. **Deleted** posts skip the fast-start requirement for **`canSkipWrite`** (lifecycle preserved).

**Write success is defined only by that saved re-read.** If either check fails, the API returns **`write_failed_compact_validation`** or **`write_failed_media_url_sanity`** and must not be treated as success.

**Normalize preview** (`POST …/preview`, `validation` on the canonical preview object) is **informational when the live Firestore doc is already compact OK**: the queue UI downgrades scary “preview blocking” to **preview mismatch only** and does **not** count those rows toward **Blocked / errors (live or write)**. Do not treat preview-only blocking errors as proof the live doc is bad if **`isCompactCanonicalPostV2(raw)`** is already OK on the loaded document.

Idempotency: **`isCompactCanonicalPostV2`** gates **Optimize + Write** and **manual Write** so **already compact** posts **skip** Firestore writes: **no backup**, **no `set`**, **no** automatic normalize preview in the optimize path (use **Preview Selected** if you explicitly want preview JSON).

## Final source of truth (writes)

| Step | Role |
|------|------|
| `isCompactCanonicalPostV2(savedDoc)` | Structural compact gate (schema, forbidden keys, required paths, video repair flags). |
| `mediaUrlSanityCheckOnSavedCompactPost(savedDoc)` | URL presence sanity on the **saved** tree (not the pre-write canonical). |
| Video playback selection check | Still compares **saved** `selectedVideoUrlsFromPostDocument(saved)` vs post-write expectation where applicable. |

Optimize + Write **complete** responses include **`savedRaw`**, **`savedRawHash`**, **`savedCompactCheck`**, **`savedMediaUrlSanity`** so the client can show the **post-write** truth without an extra preview round-trip.

## Normalize preview vs live

- Preview runs **`normalizeMasterPostV2` + `validateMasterPostV2`** on the current raw (or repaired raw in dry-runs). That path can disagree with the compact live document for legacy shapes (e.g. nested `media.assets[].image` vs flattened variants).
- **Image URL preservation**: normalize keeps **`displayUrl` / `originalUrl` / `thumbnailUrl`** from nested `image`, **`media.cover`**, **`compatibility`**, and top-level **`photoLink` / `displayPhotoLink` / `thumbUrl`** so preview validation does not emit **`image_missing_display_url`** / **`missing_cover_url`** when the Firestore-shaped doc already has those URLs.
- **Deleted posts**: if **`lifecycle.status === "deleted"`**, **`lifecycle.isDeleted`**, top-level **`deleted` / `isDeleted`**, or **`deletedAt`** is present, normalize keeps **`lifecycle.status: "deleted"`** and does not “revive” to active unless data explicitly changes. Compact live projection copies **`lifecycle`** from canonical unchanged.

## `generation_failed` (strict repair)

When **strict** mode blocks because required video variants are still unresolved after repair analysis, the API includes **`generationFailureDetail`** (built by **`buildStrictGenerationFailureDetail`** in `strictGenerationFailureDetail.ts`): reason, **`analyzeSummary`**, **`perAsset`** rows (needs map, **`sourceUrlState`** `missing` | `present_http` | `present_non_http`, skip reasons), **`generationErrors`**, **`generationErrorsDistinct`**, generated/skipped asset ids. The queue card surfaces a short **`lastError`** line; the **Validation** panel JSON includes the full **`generationFailureDetail`**.

Known IDs from recent batches (examples): **`post_8f2bbb6641728ed1`** (strict **`generation_failed`**); **`post_45d3e0147c080b6a`**-class shapes were used to regression-test nested image URLs vs preview.

## Final live post allowlist (conceptual)

Production groups on the live document:

- `schema`, `lifecycle`, `author`, `text`, `location`, `classification`, `media` (including per-asset `image` / `video` with compact `playback`, `readiness`, allowlisted `variants`, `technical`)
- `engagement`, `engagementPreview` (bounded: 5 likers, 3 comments)
- `ranking` only when **`aggregates` / `rollup`** contain at least one non-nullish value (all-null objects are omitted on live)
- `compatibility` (image posts omit empty **`posterUrl`** / **`fallbackVideoUrl`**)
- Top-level **mirrors** still read by legacy clients: `userId`, `userName`, `userHandle`, `userPic`, `title`, `content`, `activities`, `privacy`, `settingType`, `reel`, `isBoosted`, `showLikes`, `showComments`, `time`, `updatedAt`, `lat`, `long`, `geohash`, `address`, region IDs, `assetsReady`, `photoLink`, `displayPhotoLink`, `photoLinks2`, `photoLinks3`, `thumbUrl`, `posterUrl`, `fallbackVideoUrl`, `mediaType`

Implementation: **`Locava Backendv2/src/lib/posts/master-post-v2/compactCanonicalPostV2.ts`** (`compactCanonicalPostForLiveWrite`, `isCompactCanonicalPostV2`), **`savedCompactPostHealth.ts`** (`mediaUrlSanityCheckOnSavedCompactPost`).

## Forbidden on live (non-exhaustive)

Validator and builder reject or omit, among others:

- `audit`, `normalizationDebug`, `variantMetadata`, `playbackLab`, `mediaProcessingDebug`, `legacy`, top-level `likes` / `comments` arrays, duplicate `rankingAggregates` / `rankingRollup` when nested `ranking` already holds them

Full diagnostics for removed material go to **`postCanonicalDiagnostics`** and full pre-image to **`postCanonicalBackups`** (skipped when the post is **already compact** and no write runs).

## Files touched (this effort)

- `src/lib/posts/master-post-v2/compactCanonicalPostV2.ts` — checker + compact builder; omit null-only `ranking`; strip empty `image` on video assets; no `video` key on image assets
- `src/lib/posts/master-post-v2/savedCompactPostHealth.ts` — post-write URL sanity (shared + tested)
- `src/lib/posts/master-post-v2/strictGenerationFailureDetail.ts` — actionable **`generationFailureDetail`**
- `src/lib/posts/master-post-v2/compactCanonicalPostV2.test.ts`, `savedCompactPostHealth.test.ts`, `strictGenerationFailureDetail.test.ts`, `normalizeMasterPostV2.test.ts` — regression tests
- `src/routes/debug/post-rebuilder.routes.ts` — write gates, UI labels, stats, already-compact no-op behavior, NDJSON final payload fields
- `src/routes/debug/post-rebuilder.routes.test.ts` — UI string smoke checks
- `docs/post-rebuilder-compact-canonical-v2-report.md` — this document

## Tests run

```bash
cd "Locava Backendv2"
npx vitest run \
  src/lib/posts/master-post-v2/savedCompactPostHealth.test.ts \
  src/lib/posts/master-post-v2/strictGenerationFailureDetail.test.ts \
  src/lib/posts/master-post-v2/normalizeMasterPostV2.test.ts \
  src/lib/posts/master-post-v2/compactCanonicalPostV2.test.ts \
  src/routes/debug/post-rebuilder.routes.test.ts
```

All of the above passed locally after this reliability pass.

### Typecheck

Run `npm run typecheck` (or `npx tsc --noEmit`) for the whole package; unrelated files may still report errors outside this change set.

## Running the next batch safely

1. Enable **`ENABLE_POST_REBUILDER_DEBUG_ROUTES`** only in a controlled environment.
2. Load posts by rank or IDs; optionally **Preview Selected** on outliers.
3. Use **Optimize + Write** (NDJSON) or manual queue; confirm cards show **WRITE OK** / **ALREADY COMPACT · SKIPPED** and that **Blocked / errors** only reflects **live compact failure**, **write failure**, or **preview error** — not preview-only blocking when live is compact OK.
4. On **`write_failed_compact_validation`** or **`write_failed_media_url_sanity`**, use payload fields **`compactValidation`**, **`savedMediaUrlSanity`**, **`savedRaw`**, and **revert** from `postCanonicalBackups` if needed.
5. Per-post **15-minute** client-side timeout on optimize+write streams; **Cancel in-flight** if needed.

## Integration harness (manual)

1. Pick a staging post ID.
2. `POST /debug/post-rebuilder/:postId/preview` — inspect `compactCheck` (live raw) vs `validation` (preview).
3. `POST /debug/post-rebuilder/:postId/optimize-and-write` — confirm `complete` with **`savedCompactCheck`** / **`savedMediaUrlSanity`**, or `already_compact_canonical`.
4. Re-load raw — confirm **`isCompactCanonicalPostV2`** + URL sanity on the saved document.

## Remaining risks

- **Client reads**: Live docs do not carry huge debug trees; readers must use canonical media / subcollections.
- **Full replace writes**: `merge: false` means mirrors must stay complete for production readers.
- **Strict generation**: posts that cannot satisfy required ladder URLs will **`generation_failed`** with **`generationFailureDetail`** — fix media or relax strict only in controlled tooling.
