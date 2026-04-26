# Post Flow v2 Parity Audit (2026-04-24)

Scope: Phase 1 audit only. No implementation changes in this step.

## Sources Audited

### Old Native (working flow reference)
- Historical Native commit: `0ce4ed1` (`before posting fix`, includes full `src/features/post/*` tree).
- `Locava-Native` historical files:
  - `src/features/post/upload/runPostUpload.ts`
  - `src/features/post/upload/directPostUploadClient.ts`
  - `src/features/post/upload/asyncPostClient.ts`
- Existing workspace architecture notes used for corroboration:
  - `docs/POSTING_FLOW.md`
  - `Locava Backendv2/docs/surfaces/posting-upload-discovery.md`

### Old Backend v1 parity surface (as represented in current compat layer)
- Contract constants:
  - `locava-contracts/dist/index.d.ts` (`API_V1_PRODUCT_PATHS`)
- Backend v1-compatible route behavior in v2 compat:
  - `Locava Backendv2/src/routes/compat/legacy-product-upload.routes.ts`

### Current Backendv2 posting surface
- Routes/contracts:
  - `src/routes/v2/posting-*.routes.ts`
  - `src/contracts/surfaces/posting-*.contract.ts`
- Posting mutation internals:
  - `src/repositories/mutations/posting-mutation.repository.ts`
  - `src/repositories/mutations/posting-state.persistence.ts`
  - `src/services/mutations/posting-mutation.service.ts`
  - `src/orchestration/mutations/posting-finalize.orchestrator.ts`

---

## Old Working Native Post Flow (Observed)

## 1) Media picker and staging behavior
- Media is selected in post flow and converted to local `PostMediaItem[]`.
- Staging starts before publish tap (background pipeline), not only at final share.
- Session-level staging is keyed by session id; per-asset staged status is tracked locally.
- Video path attempts compression and poster generation in parallel with upload preparation.

## 2) Draft/staging object shape (client-side)
- `runPostUpload` carries:
  - media list (id/type/mediaUri/thumbnail),
  - title/caption,
  - activities,
  - location fields (`lat`, `long`, `address`),
  - privacy (`Public Spot` / `Friends Spot` / `Secret Spot`),
  - tagged users,
  - text overlays,
  - recordings,
  - layout fields (`carouselFitWidth`, gradients, layout preset/pages),
  - per-asset location metadata.
- Durable local task ids:
  - `clientTaskId`
  - `idempotencyKey`
  - `correlationId`

## 3) Upload preparation and route usage (v1)
- Primary API paths used by native upload client:
  - `POST /api/v1/product/upload/stage-presign`
  - `POST /api/v1/product/upload/stage-asset`
  - `POST /api/v1/product/upload/create-from-staged`
  - `POST /api/v1/product/upload/create-with-files`
  - `GET /api/v1/product/upload/post-by-idempotency`
  - `DELETE /api/v1/product/upload/staging/:sessionId`
- Fallback path behavior:
  - Preferred commit path: `create-from-staged` (fast metadata commit if assets already staged).
  - Fallback commit path: `create-with-files` multipart upload if staged path not ready/fails.
  - Idempotency recovery lookup on ambiguous timeout/failure.

## 4) Request/response shape highlights (old flow)
- `create-from-staged` request body includes:
  - `sessionId`, `userId`, `title`, `content`, `lat`, `long`, `address`, `privacy`,
  - `activities`, `tags`, `texts`, `recordings`,
  - layout/gradient fields,
  - optional `displayPhotoBase64`, `videoPostersBase64`.
- `create-with-files` multipart includes:
  - `files[]` media,
  - optional `displayPhoto`,
  - metadata form fields matching above.
- Success envelope (both create paths):
  - `{ success: true, postId, achievementDelta? }`
- Error envelope:
  - `{ success: false, error/message }` with non-2xx in most failures.

## 5) Optimistic UI behavior
- Local pending post id is generated (`pending-{clientTaskId}`) for progress UI.
- On successful commit, client immediately inserts optimistic profile representation using real `postId`.
- Local fallback patch stores temporary media/fields to avoid broken post opening while hydration catches up.
- Polling begins immediately after publish success for readiness.

## 6) Retry/failure behavior
- Idempotent publish guarded by idempotency key.
- Watchdog timeout on staged commit path; fallback and recovery lookup used.
- Draft save on failure path to avoid silent loss.
- Structured upload progress updates emitted through task/progress stores.

---

## Old Backend v1 Route/Handler Behavior (Audited Surface)

Note: direct old backend source was not fully enumerated in this phase; v1 behavior is reconstructed from contract paths + compat handler implementation that mirrors expected v1 semantics.

## 1) Upload/signing and staging routes
- `POST /api/v1/product/upload/stage-presign`
  - Input: `sessionId`, `items[{index, assetType, destinationKey?}]`
  - Output: signed upload URLs + object keys.
- `POST /api/v1/product/upload/stage-asset` (+ binary/poster variants)
  - Header-driven metadata (`x-posting-session-id`, `x-asset-index`, `x-asset-type`, optional final key headers).
  - Writes staged bytes to object storage.
- `POST /api/v1/product/upload/staging/confirm`
  - Verifies expected staged keys exist.
- `DELETE /api/v1/product/upload/staging/:sessionId`
  - Purges staging objects/temp state.

## 2) Post create/finalize routes
- `POST /api/v1/product/upload/create-from-staged`
- `POST /api/v1/product/upload/create-with-files`
- `POST /api/v1/product/upload/create-with-files-async` (legacy async branch)
- `GET /api/v1/product/upload/post-by-idempotency`
  - Looks up canonical post id from idempotency record.

## 3) Firestore/doc path evidence from audited code
- Explicit idempotency mapping lookup:
  - `postIdempotency/{sha256(viewerId:idempotencyKey).slice(0,32)} -> { postId }`
- Legacy post create handlers are expected to write canonical post + fanout docs; exact full v1 write set still needs a direct historical backend source extraction pass in Phase 3 prep.

---

## Canonical Post Field Compatibility Requirements (from old native expectations)

Must preserve at publish output + hydration:
- identity: `id`, `postId`, `userId` / creation user identifiers.
- user denorm: username/display name/profile photo fields used by cards/sheets.
- content: `title`, `caption`/`description`, `activities`, mentions/tags.
- location: `lat`, `long`, plus compatibility aliases (`latitude`/`longitude` where consumed).
- address/place metadata: address, placeName/place id where present.
- media: asset urls, preview urls, poster/display photo urls, type, dimensions, aspect ratio.
- visuals/layout: fit-width, gradients, layout metadata.
- privacy: public/friends/secret spot semantics.
- timestamps: `createdAt`, legacy `time-created`, `updatedAt`.
- counters: likes/comments/shares/saves defaults.
- map/feed/profile/collection compatibility fields.

---

## Current Backendv2 Gap Audit

## 1) Route shape gap vs required target
- Present now: `/v2/posting/*` first-slice mutation/status routes and `/v2/posting/staging/presign`.
- Missing canonical target routes from goal:
  - `/v2/posts/stage`
  - `/v2/posts/media/sign-upload`
  - `/v2/posts/media/complete`
  - `/v2/posts/publish`
  - `/v2/posts/:postId/card`
  - optional retry/cancel stage routes in target naming.

## 2) No-fake-data violations in current posting mutation stack
- `posting-mutation.repository.ts` currently generates synthetic ids/state:
  - `postId: post_${sessionIdSuffix}`
  - operation/media state transitions by poll counters/time simulation.
- `posting-state.persistence.ts` stores local JSON file state (`state/posting-mutations-state.json`) instead of source-of-truth DB writes.
- `posting-finalize.orchestrator.ts` returns placeholder invalidation metadata:
  - `invalidatedKeysCount: 0`
  - `invalidationTypes: ["deferred_until_read_routes"]`
- This violates required constraints:
  - no fake success,
  - no fake post ids,
  - no fallback synthetic post objects.

## 3) Source-of-truth and fanout gap
- No canonical Firestore post write path in v2 posting finalize.
- No audited/explicit v2 fanout writes for:
  - user post relationships,
  - place relationships,
  - map marker index,
  - feed eligibility indexes,
  - collection/save compatibility linkage,
  - comments/social initialization records.

## 4) Hydration gap immediately after publish
- Current finalize response does not return canonical hydrated post/card payload.
- Old native flow needs immediate renderable payload and then readiness reconciliation.

## 5) Cache invalidation precision gap
- Current mutation layer defers with generic invalidation behavior and no precise publish-key invalidation report payload.

---

## Native Integration Gaps (Current vs old expected behavior)

- Current native still depends on v1 product upload route family and compatibility assumptions.
- Publish success path expects immediate real `postId` + compatible post/card fields for profile/feed/map open.
- Any migration to new v2 route names must preserve:
  - stage-first behavior,
  - idempotency recovery behavior,
  - optimistic insertion using real backend id,
  - non-silent failure behavior (no fake publish success).

---

## Final Implementation Checklist (Parity-Oriented)

## A) Contracts/routes
- [ ] Add canonical v2 post flow contracts for stage/sign/complete/publish/detail/card (+ retry/cancel as needed).
- [ ] Add route policy metadata, latency budgets, payload byte logging, structured error envelopes.
- [ ] Ensure strict zod validation and source-of-truth-required gate on publish.

## B) Repositories/services/orchestration
- [ ] Replace synthetic posting mutation persistence with real source-of-truth repositories.
- [ ] Implement idempotent publish keyed by `viewerId + clientMutationId/stageId`.
- [ ] Publish writes canonical post + required secondary/fanout records atomically or transactionally where possible.
- [ ] Return immediate hydrated `detail` + lightweight `card` payload after publish.

## C) Compatibility fields
- [ ] Preserve all legacy-compatible post fields required by old/native UI consumers.
- [ ] Preserve timestamp and privacy semantics exactly.
- [ ] Preserve media field naming and poster/display-photo compatibility.

## D) Visibility and hydration
- [ ] Verify immediate profile visibility.
- [ ] Verify feed eligibility visibility.
- [ ] Verify map marker inclusion.
- [ ] Verify collection/save compatibility after publish.
- [ ] Verify post detail hydration correctness without fake fallback objects.

## E) Cache invalidation and observability
- [ ] Precise, bounded invalidation keys only.
- [ ] Publish invalidation logs include routeName/postId/userId/invalidatedKeys/duration.
- [ ] Add publish diagnostics for idempotent replay, dedupe, and write fanout outcomes.

## F) Testing and debug harness
- [ ] End-to-end stage -> sign -> complete -> publish -> detail -> card checks.
- [ ] Duplicate publish idempotency proves single canonical post.
- [ ] Structured failures for media/coords/privacy/source-of-truth failures.
- [ ] Debug script(s) for post flow and publish verification.

---

## Phase 1 Exit Decision

Phase 1 audit is complete enough to proceed with implementation design/execution in Phase 2+.

Critical note before implementation:
- Existing `/v2/posting/*` first-slice mutation system is currently non-canonical and contains synthetic success/state behavior. It must be replaced or hard-switched to real source-of-truth posting repositories before production parity can be claimed.

---

## Final Implementation Report (Current Pass)

Status: partial implementation completed in Backendv2 for canonical post flow routes and no-fake-data enforcement path; Native migration and full parity fanout are not yet fully complete.

### Implemented now
- Added canonical v2 route contracts:
  - `POST /v2/posts/stage`
  - `POST /v2/posts/media/sign-upload`
  - `POST /v2/posts/media/complete`
  - `POST /v2/posts/publish`
  - `GET /v2/posts/:postId/card`
- Added new route wiring and orchestration/service/repository layers:
  - `src/routes/v2/posts-publish.routes.ts`
  - `src/orchestration/mutations/posts-publish.orchestrator.ts`
  - `src/services/mutations/posts-publish.service.ts`
  - `src/repositories/mutations/posts-stage.repository.ts`
- Added Firestore-backed stage/idempotency persistence:
  - stage collection: `postStages/{stageId}`
  - publish idempotency collection: `postPublishIdempotency/{hash(viewerId:clientMutationId)}`
- Added publish idempotency replay behavior (no duplicate publish when same `clientMutationId` is re-submitted).
- Added legacy monolith publish handoff via source-of-truth path:
  - publish calls legacy `/api/v1/product/upload/create-from-staged` using configured `LEGACY_MONOLITH_PROXY_BASE_URL`.
  - missing upstream config returns structured non-200 error (no fake success).
- Added post-publish hydration payload:
  - publish response includes canonical detail payload + card payload.
- Added route metadata wiring:
  - route contract manifest entries
  - route budget policy entries
  - app registration in `createApp`.
- Added tests and debug scripts:
  - `src/routes/v2/posts-publish.routes.test.ts`
  - `scripts/debug-post-flow.mts`
  - `scripts/debug-post-publish.mts`
  - package scripts: `debug:post-flow`, `debug:post-publish`

### Additional stabilization fix included
- Fixed runtime parse issue in `src/routes/v2/search-discovery.routes.ts` (esbuild parse error around nested type assertion) so dev runtime can boot without that syntax crash.

### Commands run
- `npm run typecheck` (Backendv2) -> pass
- `npm test -- src/routes/v2/posts-publish.routes.test.ts` -> pass
- `npm test` (full suite) -> fail (pre-existing broad repository/test-environment failures not isolated to this post-flow slice)
- `npm run lint` -> script not available
- `npm run debug:post-flow` -> currently fails at media-complete readiness (missing staged object key in storage confirmation)
- `npm run debug:post-publish` -> currently fails for same reason when complete check cannot confirm object presence
- `npm run debug:parity:validate` -> fails broadly when local stack/dependencies are not fully healthy

### Remaining risks / gaps
- Native app integration to new `/v2/posts/*` routes is not completed in this pass.
- Full parity fanout verification (feed/profile/map/collections/comments initialization) still depends on legacy publish pipeline internals and needs explicit end-to-end assertions.
- Storage-complete verification can fail locally if signed upload object does not appear under expected key quickly; debug scripts currently surface this clearly.
- Existing `/v2/posting/*` first-slice synthetic path still exists in tree and should be hard-deprecated after native cutover.
- Local debug publish needs a real bearer token (`DEBUG_AUTH_TOKEN`) because legacy publish source-of-truth endpoint rejects unauthenticated requests.
- Wasabi upload verification in local env can fail strict HEAD checks; completion path now supports non-strict probe fallback unless `POST_UPLOAD_REQUIRE_STORAGE_PROBE=1` is set.

### Local debug usage notes
- Run publish flow with auth:
  - `DEBUG_BASE_URL=http://localhost:8080 DEBUG_AUTH_TOKEN=<firebase_id_token> npm run debug:post-flow`
  - `DEBUG_BASE_URL=http://localhost:8080 DEBUG_AUTH_TOKEN=<firebase_id_token> npm run debug:post-publish`
- Optional open testing mode (temporary):
  - `ALLOW_PUBLIC_POSTING_TEST=1` to allow unauthenticated public calls on `/v2/posts/*` in dev/test.
  - `LEGACY_MONOLITH_PUBLISH_BEARER_TOKEN=<token>` to let Backendv2 publish upstream without per-client auth header.
  - Disable both after testing.

### Manual test checklist (still required)
- [ ] Post one photo
- [ ] Post one video
- [ ] Post multiple photos (if supported)
- [ ] Post Public Spot
- [ ] Post Friends Spot
- [ ] Post Secret Spot
- [ ] Post with location
- [ ] Post without optional fields
- [ ] Immediately open from profile
- [ ] Immediately open from feed
- [ ] Immediately open from map
- [ ] Refresh app and verify post persists
- [ ] Kill app/reopen and verify post persists
- [ ] Retry failed upload and verify no duplicate post
