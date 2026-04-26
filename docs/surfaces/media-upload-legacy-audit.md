# Legacy Media/Upload Audit (Preservation-First)

Date: 2026-04-20  
Scope: audited old backend media/upload plane in `Locava Backend` to preserve production-critical behavior during v2 migration.

## 1) Exact Route Set Audited

Primary upload/media surfaces in old backend:

- `src/routes/directPostUpload.routes.ts` mounted under `/api/direct-post/*`
- `src/routes/v1/product/upload.routes.ts` mounted under `/api/v1/product/upload/*`
- internal async task callbacks under `/api/v1/internal/upload/*`

Core user-facing routes audited:

- `POST /api/direct-post/stage-presign` (+ v1 equivalent)
- `POST /api/direct-post/stage-asset` (+ v1 equivalent)
- `POST /api/v1/product/upload/stage-asset-binary`
- `POST /api/v1/product/upload/stage-poster`
- `POST /api/direct-post/create-from-staged` (+ v1 equivalent)
- `POST /api/direct-post/create-with-files` (+ v1 equivalent)
- `POST /api/direct-post/create-with-files-async` (+ v1 equivalent)
- `GET /api/direct-post/post-by-idempotency` (+ v1 equivalent)
- `DELETE /api/direct-post/staging/:sessionId` (+ v1 equivalent)
- poll/reconcile companions: `GET /api/posts/:postId`, `GET /api/direct-post/job-status/:jobId`

## 2) Storage and Data-Plane Strategy

Old backend uses a mixed but deliberate data-plane strategy:

- direct-to-Wasabi via presigned PUT (preferred scalable path),
- server-mediated multipart fallback (`stage-asset`),
- server-mediated raw stream path for specific compatibility (`stage-asset-binary`),
- staged asset promotion/copy into finalized keys during commit (`create-from-staged` path).

This confirms control-plane and data-plane separation already exists and should be preserved.

## 3) Registration/Staging Semantics

Observed semantics:

- session + asset index are first-class (`sessionId`, `assetIndex`),
- poster upload is distinct (video poster semantics preserved),
- staged assets can be confirmed and finalized later,
- staged purge exists for abandoned flows.

These are strongly aligned with native resume/retry behavior and must remain compatible.

## 4) Finalize + Media State Interaction

Finalize (`create-from-staged` / `create-with-files`) writes post with explicit media processing/readiness fields:

- `assets`
- `assetsReady`
- `videoProcessingStatus` / `videoProcessingProgress`
- `imageProcessingStatus` / `imageProcessingProgress`
- compatibility payload fields under legacy shapes

Native assumptions rely on this state progression and poll behavior.

## 5) Readiness and Async Processing

Readiness is not “upload complete”; it is tied to processing state:

- async processing via Cloud Tasks callbacks,
- status transitions gate `assetsReady`,
- clients reconcile through `GET /api/posts/:postId`,
- idempotency lookup path supports ambiguous finalize recovery.

## 6) Retry/Resume/Idempotency

Strong existing semantics:

- idempotency key mapping to post identity,
- staged session resumability,
- repeated finalize safety with lookup,
- replay/polling compatibility with native task model.

Must preserve this behavior in v2 control-plane slices.

## 7) Native Compatibility Assumptions (Critical)

Native likely assumes:

- staged session + indexed assets + poster semantics,
- finalize acknowledgment plus later readiness progression,
- poll/reconcile ability after timeout/app restart,
- idempotency replay returns same publish identity.

Breaking sequence or field semantics would risk regressions in “sometimes instant/sometimes forever” paths.

## 8) What Is Good and Should Be Preserved

- Direct-to-storage first strategy.
- Session-based staging with explicit asset indexing.
- Idempotent finalize + idempotency lookup.
- Readiness as explicit state machine, not implicit upload success.
- Deferred heavy processing outside synchronous user path.

## 9) Risky/Brittle Areas in Legacy

- Overlapping legacy/v1 route surfaces risk drift.
- Controller-level complexity and branch density in direct upload controller.
- Multipart memory paths still exist and can create memory-pressure risk if misused.
- Mixed sync/async code paths increase behavior coupling risk.

## 10) Safe Improvements Without Behavior Breakage

- Preserve external semantics, simplify internal orchestration.
- Strengthen route-level idempotency visibility and diagnostics parity.
- Keep direct-to-storage as default; bound and de-emphasize server-upload paths.
- Keep readiness/status semantics stable while hardening control-plane transitions.

## 11) Behavior That Must Remain Compatible

Must preserve:

- staging session + asset-index model,
- idempotency replay semantics,
- finalize -> processing/readiness progression expectations,
- poll/reconcile contract style (status/readiness visibility),
- non-blocking finalize for heavy media processing.
