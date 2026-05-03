# Backend V2 video faststart / playbackLab repair (2026-05-03)

## Root cause

- Native finalize (`publishNativeCanonicalPost`) never performed real transcoding; it relied on an external `video-processor` HTTP worker. When that worker was missing, misconfigured, or did not match the new post shape, posts stayed on **original** URLs while some readiness flags drifted out of sync with real generated files.
- `buildPostMediaReadiness` treated **playbackReady** as dependent on `assetsReady` / `videoProcessingStatus === "completed"`, so clients could not treat **startup lab** URLs as playable while full production variants were still encoding.
- Native upload polling (`postPlaybackStartupReadiness`) treated any string `variants.main720Avc` as success even when it equaled `original`.

## What we implemented

### 1) In-process worker on Backendv2

- **Route:** `POST /video-processor` (Cloud Tasks–compatible JSON body: `{ postId, userId, videoAssets: [{ id, original }] }`).
- **Pipeline:** `ffmpeg`/`ffprobe` download → transcode → Wasabi upload under `videos-lab/{postId}/{assetId}/…` → Firestore merge.
- **Optional auth:** set `VIDEO_PROCESSOR_TASK_SECRET`; Cloud Tasks and sync finalize calls send `x-locava-video-processor-secret`. Enqueue path updated in `video-processing-cloud-task.service.ts`.

### 2) Generated ladder (production)

**Always**

| Output | Storage / role |
| --- | --- |
| `preview360_avc.mp4` | `variants.preview360` + `variants.preview360Avc` |
| `main720_avc.mp4` | `variants.main720Avc`, `legacy.photoLinks3` target |
| `startup540_faststart_avc.mp4` | `playbackLab.assets[id].generated.startup540Faststart(Avc)` |
| `startup720_faststart_avc.mp4` | `playbackLab.assets[id].generated.startup720Faststart(Avc)` |
| `poster_high.jpg` | `playbackLab.generated.posterHigh` (per-asset lab node) |
| `diagnosticsJson` | embedded in `generated.diagnosticsJson` |

**Conditional (1080-class source)** — shortest side ≥ 1080 (excludes 720p and ultrawide 1920×800)

| Output | Role |
| --- | --- |
| `startup1080_faststart_avc.mp4` | startup 1080 |
| `upgrade1080_faststart_avc.mp4` | higher quality upgrade; also fills `variants.main1080` / `main1080Avc` |

**HEVC `main720`**

- Off by default. Enable with `VIDEO_MAIN720_HEVC_ENABLED=1` and working `libx265`. Otherwise `variants.main720` aliases `main720Avc`.

### 3) Readiness semantics

- **playbackReady / playbackUrlPresent:** `media-readiness.ts` now treats any **non-original** processed URL (including `startup540` / `startup720` lab URLs) as sufficient for `playbackReady`, without waiting for `assetsReady`.
- **mediaStatus:** `ready` only when `videoProcessingStatus === "completed"` **and** `assetsReady`; otherwise `processing` (or `failed`).
- **Finalize doc:** `playbackLab.status` / `playbackLabStatus` initial **`queued`** (was `pending`).

### 4) Native client

- `postPollingStartupReadiness.ts` ignores variant/lab URLs that equal `asset.original` for startup, preview AVC, and mains.

### 5) Repair / ops

- Script: `npm run repair:video-playback -- --postId <id> [--dry-run]`
- Re-enqueues Cloud Task to `VIDEO_PROCESSOR_FUNCTION_URL` (point this at your deployed Backendv2 `/video-processor` URL).

## Files changed (high level)

- `src/services/video/*` — moov probe, ffprobe, ffmpeg runner, encoding pipeline, Wasabi upload, Firestore merge (`video-post-processor.service.ts`), source policy.
- `src/routes/compat/video-processor.routes.ts` — HTTP entry.
- `src/app/createApp.ts` — register route.
- `src/services/posting/video-processing-cloud-task.service.ts` — optional secret header.
- `src/services/posting/buildPostDocument.ts` — queued playbackLab.
- `src/lib/posts/media-readiness.ts` — playbackReady + startup540 ordering.
- `src/routes/contracts.ts`, `package.json` — surface + npm script.
- Tests under `src/services/video/`, `src/lib/posts/media-readiness.test.ts`, `src/routes/compat/video-processor.routes.test.ts`.
- `scripts/repair-video-playback-faststart.mts`
- Native: `Locava-Native/src/features/post/upload/postPollingStartupReadiness.ts`

## Deploy

- **Cloud Run / container:** image must include **`ffmpeg` and `ffprobe`** (e.g. Debian `apt-get install -y ffmpeg`). Without them, the worker returns 500.
- **Env**
  - `VIDEO_PROCESSOR_FUNCTION_URL` — set to `https://<your-v2-host>/video-processor` when Backendv2 owns the worker.
  - `VIDEO_PROCESSOR_TASK_SECRET` — recommended; must match Cloud Tasks OIDC-less header `x-locava-video-processor-secret`.
  - Wasabi: `WASABI_*` / `AWS_*` (existing).
  - Optional: `VIDEO_MAIN720_HEVC_ENABLED=1`, `FFPROBE_BIN`, `FFMPEG_BIN` if binaries are non-default.

```bash
# Example: build and deploy (adjust to your pipeline)
cd "Locava Backendv2" && npm run build
# then deploy your Cloud Run service / image per infra (cloudbuild, gcloud run deploy, etc.)
```

## Manual verification checklist

1. Post a new video via native finalize.
2. Firestore `posts/{postId}` immediately: `assetsReady: false`, variants without fake `main720*` equal to `original`, `playbackLab.status: "queued"`.
3. After worker: `videos-lab/{postId}/{assetId}/*.mp4` exist; `variants.preview360Avc` / `main720Avc` ≠ `original`; `playbackLab.assets[assetId].generated` contains startup URLs; `lastVerifyResults` entries include `moov_before_mdat_in_prefix`.
4. `assetsReady`, `videoProcessingStatus: "completed"`, `playbackReady`, `playbackUrlPresent` coherent.
5. Native: feed/carousel picks startup tier without stalling on original.

## Tests run locally

```bash
cd "Locava Backendv2" && npm run typecheck
cd "Locava Backendv2" && npx vitest run \
  src/services/video/video-source-policy.test.ts \
  src/services/video/mp4-moov-hint.test.ts \
  src/services/video/remote-url-verify.test.ts \
  src/lib/posts/media-readiness.test.ts \
  src/routes/compat/video-processor.routes.test.ts \
  src/services/posting/native-post-document.test.ts
```

```bash
cd "Locava Backendv2" && npm run repair:video-playback -- --dry-run --postId post_8f2bbb6641728ed1
```

(requires live Firestore credentials in env)
