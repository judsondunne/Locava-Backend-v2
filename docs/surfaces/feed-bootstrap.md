# Feed Bootstrap (Surface)

## Purpose

`GET /v2/feed/bootstrap` returns the first interactive feed payload with strict first-render bounds and deferred hints.

## Route

- `GET /v2/feed/bootstrap`

Query:

- `limit` (`4-8`, default `5`)
- `debugSlowDeferredMs` (`0-2000`, default `0`)

## Contract Summary

Response:

- `routeName: "feed.bootstrap.get"`
- `firstRender.viewer`
- `firstRender.feed.page` (`limit`, `count`, `nextCursor`, `sort`)
- `firstRender.feed.items[]` (`PostCardSummary`)
- `deferred.sessionHints`
- `background.prefetchHints`
- `degraded`, `fallbacks`

## Source-of-Truth Status

- candidate retrieval path is now source-backed when Firestore is available
- adapter: bounded `posts` query ordered by `createdAtMs desc`
- selected fields: `feedSlot`, `createdAtMs`, `updatedAtMs`
- strict timeout fallback to deterministic repository behavior

Still synthetic in this phase:

- slot-mapped `postId` and card internals that remain on existing feed shared shaping path
- deferred `sessionHints`

## Request-Pressure Strategy

- strict limit cap (`<=8`)
- no per-item detail fan-out
- route cache key: `bootstrap:feed-bootstrap-v1:{viewer}:{limit}`
- candidates cache key: `list:feed-candidates-v1:{viewer}:{limit}`
- in-flight dedupe + concurrency caps in service
- timeout/fallback markers recorded for deferred and source fallback paths

## Route Policy and Budgets

- route policy: `feed.bootstrap.get`
- priority: `critical_interactive`
- latency: p50 `110ms`, p95 `240ms`
- db ops cold: reads `<=14`, queries `<=3`
- payload: target `20KB`, max `38KB`
- cache expectation: `required`
- concurrency expectation: dedupe expected, max repo ops `4`

## Diagnostics Verification

Verify for `feed.bootstrap.get`:

- `routeName`, `routePolicy`
- `payloadBytes`
- `dbOps`
- `cache`, `dedupe`, `concurrency`
- `entityCache`, `entityConstruction`
- `fallbacks`, `timeouts`
- `budgetViolations`

## Intentionally Not Included

- detail hydration
- comments trees
- media ladder expansion
- heavy ranking/debug payloads

## Tradeoffs

- source candidate retrieval improves cold-path realism
- slot-based card shaping remains for contract stability until detail source path is integrated
