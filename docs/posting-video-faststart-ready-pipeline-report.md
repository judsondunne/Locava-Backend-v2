# Native posting: video fast-start → compact ready (no rebuilder)

## Summary

New posts stay **instant on Share** (no encode in the finalize request). Async video processing now encodes only a **fast-path ladder**, verifies it, **trusts moov-at-start URLs** via `playbackLab.verification.byUrl`, runs **`normalizeMasterPostV2` → `validateMasterPostV2` → `compactCanonicalPostForLiveWrite`**, and **replaces** `/posts/{postId}` with the same compact live shape the Post Rebuilder uses. Heavy encoder output is written to **`mediaProcessingDiagnostics/{postId}_{ms}`**.

## Required variants (default fast path)

| Variant | Role |
|--------|------|
| `startup540FaststartAvc` | Poor / weak network tier |
| `startup720FaststartAvc` | Default / primary / good / HQ / upgrade when `main720Avc` is not generated |

## Optional (env-gated)

| Variant | When |
|---------|------|
| `posterHigh` | Only if there is no confident HTTPS poster image on the asset |
| `preview360Avc` | `NATIVE_POST_READY_INCLUDE_PREVIEW360=1` |
| `main720Avc` | `NATIVE_POST_READY_INCLUDE_MAIN720=1` |

## Deferred (not in default async job)

`startup1080FaststartAvc`, `upgrade1080FaststartAvc`, `main1080`, `main1080Avc`, HLS, HEVC — reserved for a future **deferred_quality_upgrade** job (`status: deferred_quality_upgrade`) that must not block `assetsReady` / `instantPlaybackReady`.

## Policy helper

`getRequiredVariantsForPostReady()` and `buildNativeFastPathEncodeOnly()` live in `src/services/video/post-ready-variant-plan.ts`.

## Phase 1 — finalize (instant)

`buildNativePostDocument` for video:

- `mediaStatus: "processing"`, `assetsReady: false`, `instantPlaybackReady: false`, `videoProcessingStatus: "pending"`.
- Top-level `lifecycle: { status: "processing", … }` so canonical lifecycle matches processing.
- `mergeMasterPostV2IntoNativeFinalizeDocument` unchanged; **audit `normalizationDebug` is stripped** on video creates to reduce live bloat.

## Phase 2 — async processor

`processVideoPostJob` (`src/services/video/video-post-processor.service.ts`):

1. **Idempotent exit** if `normalizeMasterPostV2` shows `media.status === "ready"` and video readiness flags are already satisfied.
2. **Encode** with `encodeOnly` from the fast-path plan (`enableMain720Hevc: false`).
3. **Verify** only URLs that exist (startup540/720; preview/main720 only if generated).
4. Build **`playbackLab.verification.byUrl`** for startup URLs so `selectCanonicalVideoPlaybackAsset` treats them as verified without multi-minute remote probes (default `VIDEO_ENABLE_REMOTE_UPLOAD_VERIFY` off).
5. Set **`lifecycle.status: "active"`**, **`mediaStatus` / `videoProcessingStatus` / readiness** on the working raw doc before normalize.
6. **`writeCompactLivePostAfterNativeVideoProcessing`** — diagnostics doc + **`postRef.set(..., merge: false)`** + `videoProcessingProgress: FieldValue.delete()` on the payload.

## Path normalization

Encoder continues to use `normalizeVideoLabPostFolder` via `videosLabKeyPrefix` (no `post_post_*` folders).

## Validators

| Function | Intent |
|----------|--------|
| `detectPlaybackLabGeneratedNotPromoted` | Lab has `startup720FaststartAvc` but canonical playback still on `original_unverified_fallback` / original default |
| `evaluatePostRebuildReadiness` | Adds `generated_variants_not_promoted_to_canonical_media` and blocks `canSkipWrite` when the above holds |
| `isCompactProcessingPostV2` | Schema v2 + `lifecycle` + `media.status` both `processing` |
| `isCompactReadyPostV2` | `compactOk` + `canSkipWrite` + `lifecycle.active` + `media.ready` |

## Timing

Removing default **1080 + upgrade + main720 + preview** encodes avoids several long ffmpeg passes; typical savings are **minutes → tens of seconds** for short vertical clips (exact wall time still depends on source resolution, CPU, and Wasabi upload latency).

## Tests run (local)

- `src/services/video/post-ready-variant-plan.test.ts`
- `src/services/posting/native-video-post-ready-pipeline.test.ts`
- `src/services/posting/native-post-document.test.ts`
- `src/lib/posts/master-post-v2/compactCanonicalPostV2.test.ts`
- `src/routes/compat/video-processor.routes.test.ts`

## Risks / follow-ups

- **`merge: false`** replaces the entire post document; a whitelist preserves operational keys (`sessionId`, `tags`, …). If clients add new top-level fields, extend `PRESERVE_TOP_LEVEL_KEYS` in `native-async-video-post-complete.ts`.
- **1080 / HLS enrichment** is intentionally not scheduled yet; wire a low-priority queue job when product wants it.
- **Remote verify off by default** relies on encoder local moov checks + explicit `verification.byUrl` trust for the fast path; turn `VIDEO_ENABLE_REMOTE_UPLOAD_VERIFY=1` for stricter production probing at the cost of latency.
