# Posting/Upload Discovery (Native -> v2 Migration)

Date: 2026-04-20  
Scope: current `Locava-Native` post creation/upload lifecycle and implications for backend v2 posting surface.

## 1) Exact Native Posting Lifecycle Found

Primary flow (online):

1. User taps share from post composer flow (`PostLayoutLogic`).
2. Client starts/updates a durable post task (`clientTaskId`, `idempotencyKey`, `correlationId`) in local task store.
3. Client waits for staged assets session readiness (`postSessionStaging`).
4. Client commits through `POST /api/v1/product/upload/create-from-staged`.
5. On commit success, client writes optimistic local fallback post and begins readiness polling.
6. Client polls `GET /api/posts/:postId` until startup/canonical media readiness gates pass.
7. Task transitions to committed-ready and local fallback can be replaced with canonical post payload.

Offline branch:

- If offline-mode path is active, share action enqueues `post_upload` item in offline queue and replays later.

## 2) Upload Lifecycle Stages in Current Native

- Stage orchestration:
  - `stage-presign`
  - direct object upload to signed URL
  - poster staging
  - binary/multipart fallback staging routes
- Commit:
  - `create-from-staged` with idempotency key
- Reconcile:
  - idempotency lookup (`post-by-idempotency`) on ambiguous finalize outcomes
  - polling for readiness
- Cleanup/cancel:
  - staging purge and optional post delete cleanup in some paths

## 3) Immediate vs Deferred Needs (Client Perspective)

Immediate needs:

- stable operation/session identifiers,
- commit acknowledgment with post identity reference,
- fast response that lets UI move to pending/processing state.

Deferred needs:

- media variant readiness details,
- canonical post hydration details,
- eventual processing completion metadata.

## 4) Duplicate/Retry/Poll Pressure Risks Identified

- duplicate session creation under repeated taps/resumes,
- duplicate finalize attempts with same intent,
- idempotency lookup storms after timeout ambiguity,
- aggressive polling loops against post detail/read routes,
- upload + polling + normal feed/profile requests contending on bad network.

## 5) Most Likely "Instant vs Forever" Contributors

- staging readiness wait windows and fallback branches,
- finalize ambiguity with retries and recovery lookups,
- readiness checks coupled to heavy canonical post payload state,
- overlap of offline replay and active user-triggered upload.

## 6) Clean v2 Route Shape Recommendation

Keep the first v2 posting slice narrow and controlled:

- `POST /v2/posting/upload-session`
  - create or replay upload session by `(viewerId, clientSessionKey)`
- `POST /v2/posting/finalize`
  - finalize exactly once per `(viewerId, idempotencyKey)` and return operation token
- `GET /v2/posting/operations/:operationId`
  - reconcile operation status with bounded polling cadence

Why this shape:

- removes finalize ambiguity by giving operation ownership to backend,
- avoids giant all-in-one upload mutation route,
- shifts client from "retry finalize blindly" to "poll status sparingly",
- creates explicit sync/deferred boundary.

## 7) Synchronous vs Asynchronous Boundary Recommendation

Synchronous request/response:

- session creation, finalize acceptance, and operation token issuance.

Deferred:

- heavy media processing, canonical detail enrichment, downstream fanout.

Rule:

- finalize must return quickly and never block on heavy media processing.

## 8) Files Audited (Native)

- `Locava-Native/src/features/post/PostLayoutLogic.tsx`
- `Locava-Native/src/features/post/upload/runPostUpload.ts`
- `Locava-Native/src/features/post/upload/postSessionStaging.ts`
- `Locava-Native/src/features/post/upload/directPostUploadClient.ts`
- `Locava-Native/src/features/post/upload/postPolling.ts`
- `Locava-Native/src/features/post/upload/postPollingStartupReadiness.ts`
- `Locava-Native/src/features/post/upload/postTask.reconcile.ts`
- `Locava-Native/src/features/post/upload/postTask.store.ts`
- `Locava-Native/src/features/offline/offlineQueue.ts`
- `Locava-Native/src/data/clients/apiClient.ts`

## 9) Migration Notes for This Phase

- No native changes in this phase.
- Implement only first safe slice with strict idempotency and diagnostics.
- Do not attempt full media processing pipeline replacement in one phase.
