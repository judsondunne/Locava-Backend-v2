# Posting V2 Canonical Finalize Parity (2026-04-24)

## Problem Proven

- Native upload flow returned success and `postId` from `POST /v2/posting/finalize`.
- Canonical read `GET /api/posts/:postId` returned `404`.
- Map markers stayed `304` against stale marker cache.
- Native fell back to local/ghost merge path because canonical post was missing.

Root cause: `posting.finalize` in Backendv2 used `posting-mutation.repository` synthetic state and generated synthetic post ids, without creating canonical Firestore `posts/{postId}`.

## Old vs Current Gap

- Old flow (v1) created canonical post docs and user/post references before success.
- Current v2 finalize previously finalized an operation model only, then returned success.
- This violated parity and caused false-success uploads.

## Fix Implemented

### Backendv2 finalize path

- Extended `POST /v2/posting/finalize` body to carry publish metadata (`title`, `content`, `activities`, `lat`, `long`, `address`, `privacy`, `tags`, `texts`, `recordings`).
- `PostingMutationService.finalizePosting()` now:
  - creates/reuses finalize operation idempotently,
  - calls legacy canonical creator (`/api/v1/product/upload/create-from-staged`) through configured monolith base,
  - verifies canonical Firestore existence (`posts/{postId}`) before returning success,
  - marks operation with real `postId`,
  - returns `canonicalCreated: true`.
- If canonical write/verification fails, operation is marked failed and finalize returns error (no fake success).

### Cache invalidation

- On `posting.complete`, invalidates map marker cache keys (`map:markers:v1`, `map:markers:v2`) in addition to post/detail/viewer-state invalidation.

### Canonical read compatibility

- Added `GET /api/posts/:postId` compat route backed by Firestore `posts` collection to support native post verification and polling.

### Native safety patch

- Native finalize client now requires `canonicalCreated === true` from `/v2/posting/finalize`.
- Native now verifies canonical read via `GET /api/posts/:postId` before marking upload complete / showing success flow.
- If verification fails, task is marked retryable and draft-safe failure path is used instead of false success.

## Files Changed

- `src/contracts/surfaces/posting-finalize.contract.ts`
- `src/routes/v2/posting-finalize.routes.ts`
- `src/orchestration/mutations/posting-finalize.orchestrator.ts`
- `src/services/mutations/posting-mutation.service.ts`
- `src/repositories/mutations/posting-mutation.repository.ts`
- `src/cache/entity-invalidation.ts`
- `src/routes/compat/legacy-api-stubs.routes.ts`
- `scripts/debug-posting-canonical-finalize.mts`
- `package.json`
- `Locava-Native/src/features/post/upload/directPostUploadClient.ts`
- `Locava-Native/src/features/post/upload/runPostUpload.ts`
- `Locava-Native/src/features/post/upload/postTask.types.ts`
- `Locava-Native/src/features/post/upload/postTask.store.ts`
- `Locava-Native/src/features/post/upload/postTask.reconcile.ts`

## Test/Validation Notes

- Backend posting route tests still run against v2 routes.
- Native syntax checks pass after safety patch.
- New debug script validates canonical post existence and read-path visibility after finalize.

## Remaining Risks

- Full field-by-field parity against Sunday v1 post document is not yet fully asserted in one dedicated snapshot test.
- Canonical creation currently relies on monolith create-from-staged when enabled; complete pure-v2 canonical writer remains future work.
