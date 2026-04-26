# Posting/Upload v2 (Durability + Cancel/Retry Slice)

Date: 2026-04-20  
Phase scope: durable control-plane persistence, cancel/retry semantics, completion invalidation hooks.

## Lifecycle (v2 First Slice)

1. Client requests upload session:
   - `POST /v2/posting/upload-session`
2. Client finalizes publish intent:
   - `POST /v2/posting/finalize`
3. Client reconciles processing state:
   - `GET /v2/posting/operations/:operationId`
4. Optional operation controls:
   - `POST /v2/posting/operations/:operationId/cancel`
   - `POST /v2/posting/operations/:operationId/retry`

This separates acceptance of publish from eventual readiness.

## Route List

### `POST /v2/posting/upload-session`

- Route name: `posting.uploadsession.post`
- Purpose: create/replay upload session safely.
- Input:
  - `clientSessionKey` (idempotency key for session creation)
  - `mediaCountHint`
- Output:
  - `sessionId`, `state`, `expiresAtMs`
  - idempotency replay flag
  - recommended polling interval
- Priority: `critical_interactive`

### `POST /v2/posting/finalize`

- Route name: `posting.finalize.post`
- Purpose: finalize exactly once per publish intent.
- Input:
  - `sessionId`
  - `idempotencyKey`
  - `mediaCount`
- Output:
  - `postId`
  - `operationId` + initial operation state
  - idempotency replay flag
  - invalidation summary placeholder (none in this slice)
- Priority: `critical_interactive`

### `GET /v2/posting/operations/:operationId`

- Route name: `posting.operationstatus.get`
- Purpose: bounded reconcile polling.
- Output:
  - operation state, pollCount, terminalReason, retryCount
  - `shouldPoll` and recommended interval
  - completion invalidation status
- Priority: `deferred_interactive`

### `POST /v2/posting/operations/:operationId/cancel`

- Route name: `posting.operationcancel.post`
- Purpose: cancel operation if still cancellable.
- Behavior:
  - `processing` -> `cancelled`
  - repeated cancel on `cancelled` is idempotent no-op
  - cancel on `completed` returns invalid transition (`409`)
- Priority: `deferred_interactive`

### `POST /v2/posting/operations/:operationId/retry`

- Route name: `posting.operationretry.post`
- Purpose: retry operation from allowed terminal states.
- Behavior:
  - `cancelled`/`failed` -> `processing`
  - repeated retry on `processing` is idempotent no-op
  - retry on `completed` returns invalid transition (`409`)
- Priority: `deferred_interactive`

## Synchronous vs Deferred Work

Synchronous:

- session creation/replay
- finalize acceptance and operation token creation
- cheap status reads

Deferred:

- full media processing and heavy post-read enrichment (future slices)

## Idempotency Strategy

- Session idempotency key: `(viewerId, clientSessionKey)`
  - repeated requests replay existing open session.
- Finalize idempotency key: `(viewerId, idempotencyKey)`
  - duplicate finalize returns same `operationId` and `postId`.
- cancel/retry are operation-scoped and idempotent on repeated equivalent requests.
- Request diagnostics records `idempotency.hits/misses`.

## Request-Pressure Strategy

- in-flight dedupe on all three routes for same logical key,
- in-flight dedupe on cancel/retry as well,
- per-route concurrency caps:
  - session create lane: 12
  - finalize lane: 8
  - status lane: 20
  - cancel lane: 8
  - retry lane: 8
- finalize serialized by mutation lock on `(viewerId, sessionId)`,
- cancel/retry serialized by mutation lock on `(viewerId, operationId)`,
- status route returns explicit polling cadence to discourage tight loops.

## Polling/Reconcile Strategy

- status route is canonical reconcile surface for finalize outcome,
- processing transitions are represented explicitly as operation state,
- clients should poll only while `shouldPoll=true`.
- completion invalidation is applied once and tracked via `completionInvalidatedAtMs`.

## Durable Persistence

- Posting sessions and operations are persisted to:
  - `state/posting-mutations-state.json`
- This keeps operation/session state available across server restarts in the same environment.
- Persistence is append/update style by operation/session id with serialized writes.

## Route Policies and Budgets

Defined in `src/observability/route-policies.ts`:

- `posting.uploadsession.post`
  - latency: p50 80ms / p95 180ms
  - dbOps: reads<=2, queries<=2
  - payload: target 2.5KB, max 8KB
- `posting.finalize.post`
  - latency: p50 95ms / p95 220ms
  - dbOps: reads<=4, queries<=4
  - payload: target 3KB, max 10KB
- `posting.operationstatus.get`
  - latency: p50 70ms / p95 170ms
  - dbOps: reads<=2, queries<=2
  - payload: target 2.5KB, max 8KB
- `posting.operationcancel.post`
  - latency: p50 80ms / p95 180ms
  - dbOps: reads<=3, queries<=3
  - payload: target 2KB, max 8KB
- `posting.operationretry.post`
  - latency: p50 85ms / p95 200ms
  - dbOps: reads<=3, queries<=3
  - payload: target 2.5KB, max 9KB

## Observability Expectations

Each route emits:

- `routeName`
- `routePolicy`
- `payloadBytes`
- `dbOps`
- `dedupe`
- `concurrency`
- `idempotency`
- `invalidation`
- `budgetViolations`

Validate via `/diagnostics`.

## Intentionally Not Implemented Yet

- media upload binary/staging routes in v2,
- durable background workers and distributed locking,
- full source-of-truth processing pipeline,
- native client cutover.

## Tradeoffs (This Slice)

- Durable state here is process-local file persistence, not multi-instance consensus state.
- Completion invalidation intentionally targets entity/detail keys only.
- List caches remain TTL-driven to avoid invalidation storms.

## Completion Invalidation (Scoped)

On first transition to `completed`, invalidate only:

- `post:{postId}:social`
- `post:{postId}:card`
- `post:{postId}:detail`
- `post:{postId}:viewer:{viewerId}:state`
- deterministic route-detail cache keys for feed/profile post detail

Intentionally not invalidated:

- feed/search/profile list caches across cursor/query spaces.

Accepted stale window:

- list pages may lag until TTL expiry; this is deliberate for pressure safety.

## Verification Commands

### Run tests

```bash
npm test -- src/routes/v2/posting.routes.test.ts src/repositories/mutations/posting-state.persistence.test.ts src/routes/v2/mutations.routes.test.ts
```

### Run service locally

```bash
npm run dev
```

### Curl checks

```bash
curl -sS -X POST "http://localhost:3000/v2/posting/upload-session" \
  -H "content-type: application/json" \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal" \
  -d '{"clientSessionKey":"session-001","mediaCountHint":2}'
```

```bash
curl -sS -X POST "http://localhost:3000/v2/posting/finalize" \
  -H "content-type: application/json" \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal" \
  -d '{"sessionId":"<SESSION_ID>","idempotencyKey":"idem-001","mediaCount":2}'
```

```bash
curl -sS "http://localhost:3000/v2/posting/operations/<OPERATION_ID>" \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal"
```

```bash
curl -sS -X POST "http://localhost:3000/v2/posting/operations/<OPERATION_ID>/cancel" \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal"
```

```bash
curl -sS -X POST "http://localhost:3000/v2/posting/operations/<OPERATION_ID>/retry" \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal"
```

```bash
curl -sS "http://localhost:3000/diagnostics?limit=30"
```
