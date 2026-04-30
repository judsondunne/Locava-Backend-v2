# Feed For You Critical Bug Audit

## Scope

Audited these files exactly:

- `src/routes/v2/feed-for-you.routes.ts`
- `src/orchestration/surfaces/feed-for-you.orchestrator.ts`
- `src/services/surfaces/feed-for-you.service.ts`
- `src/repositories/surfaces/feed-for-you.repository.ts`
- `src/contracts/surfaces/feed-for-you.contract.ts`
- Native integration:
  - `Locava-Native/src/features/home/backendv2/feedV2.repository.ts`
  - `Locava-Native/src/features/home/backendv2/feedV2.normalize.ts`
  - `Locava-Native/src/features/home/backendv2/feedV2.owner.ts`

## Exact Broken Path (Root Causes)

### 1) `rankingVersion: "unknown"` on successful first request

Root cause:

- Route summary logger reads `payload.debug?.rankingVersion ?? "unknown"`.
- Orchestrator only includes `debug` when request has `debug=1`.
- Without `debug=1`, successful responses still carry items/nextCursor/exhausted, but no debug object.
- Result: summary log reports `"unknown"` although real service path ran.

### 2) `candidateDocsFetched: 0` while `returnedCount: 5`

Root cause:

- Same mechanism: route log derives metrics from optional `payload.debug`.
- Without `debug=1`, `payload.debug` absent -> `candidateDocsFetched` defaulted to `0`.
- Items are still returned from service/repository, so counts diverge and logs look false.

### 3) `servedWriteCount: 0` while request context shows `writes: 5`

Root cause:

- Served writes happen in repository via `writeServedPosts`, which increments request db write counters.
- Route summary still reads `payload.debug?.servedWriteCount` and defaults to `0` when debug omitted.
- So db telemetry is true (`writes: 5`), but route summary says `0`.

### 4) `nextCursorPresent: false` while Native receives/uses cursor

Root cause:

- `nextCursorPresent` in route summary is also read from optional debug object.
- Response-level `nextCursor` is present even when debug block is omitted.
- Native uses response `nextCursor` directly; route log defaults `nextCursorPresent=false`.

### 5) Cursor can enter `recycleMode: true` right after first page

Root cause:

- Current service sets `recycleMode` based on `sourceMix.fallback > 0`.
- Fallback flag is tied to recycled picks inside current bounded windows, not true global unseen exhaustion.
- This can mark recycle mode early (page 1) when unseen still exists beyond bounded cursor windows.

### 6) Page 2 can return `exhausted: true` with reads appearing as `0`

Root cause:

- Read/query counters can show near-zero on cache-heavy requests (candidate and served caches).
- Current exhausted logic can still evaluate true from page-local window conditions.
- Combined effect: response says exhausted while telemetry appears to show no candidate work in this request.
- Also, when debug is omitted, summary fields default to zero, amplifying false “no work done” appearance.

## Why this is Critical

- Route summary diagnostics can lie under normal requests (without debug flag).
- Cursor recycle semantics are too eager and can push the client into bad pagination state.
- Exhausted signaling can be emitted from bounded local state without hard proof that global eligible inventory is gone.

## Required Fix Direction

1. Canonical single For You response builder with debug always present and truthful.
2. Remove ambiguous fallback/diagnostic defaulting behavior.
3. Upgrade to `fast-reel-first-v4` and `fy:v4` cursor.
4. Ensure exhausted cannot be true when no real candidate query attempt happened.
5. Ensure first page cannot look exhausted/terminal after only one full page when pool still has candidates.

