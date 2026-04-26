# Home/Feed Bootstrap (Surface)

## Purpose

`GET /v2/feed/bootstrap` is the lean first-render entry point for opening Home feed in v2.  
It is intentionally scoped to fast card rendering under startup pressure, not full feed hydration.

## Route

- `GET /v2/feed/bootstrap`

Query:

- `limit` (optional, `4-8`, default `5`)
- `debugSlowDeferredMs` (optional, `0-2000`, default `0`)

## Contract Summary

Response:

- `routeName: "feed.bootstrap.get"`
- `firstRender.viewer`
- `firstRender.feed.page` (`limit`, `count`, `nextCursor`, `sort`)
- `firstRender.feed.items[]` (lightweight card shape only)
- `deferred.sessionHints` (nullable, timeout/fallback protected)
- `background` hints
- `degraded` and `fallbacks`

Item shape is intentionally lightweight:

- `postId`, `rankToken`
- `author` summary
- `captionPreview`
- `media` startup hint + poster
- `social` summary
- `viewer` flags
- `updatedAtMs`

## First-Render / Deferred / Background

- **First-render:** minimal card list for immediate feed open.
- **Deferred:** `sessionHints` (recommendation-path metadata); times out without blocking response.
- **Background:** cache warming and next-step prefetch hints only.

## Route Policy and Budgets

Route policy: `feed.bootstrap.get`

- priority: `critical_interactive`
- latency: p50 `110ms`, p95 `240ms`
- db ops (cold): max reads `14`, max queries `3`
- db ops (warm expected): reads `2`, queries `1`
- payload: target `20,000` bytes, max `38,000` bytes
- cache expectation: `required`
- concurrency expectation: dedupe expected, max concurrent repo ops `4`

## Cache Ownership

- bootstrap response cache key: `bootstrap:feed-bootstrap-v1:<viewerId>:<limit>` (TTL 3s)
- candidate list cache key: `list:feed-candidates-v1:<viewerId>:<limit>` (TTL 8s)
- in-flight dedupe:
  - `feed-bootstrap-candidates:<viewerId>:<limit>`
  - `feed-bootstrap-session-hints:<viewerId>:<slowMs>`

## Dedupe / Concurrency Strategy

- service layer wraps repository calls with `dedupeInFlight`
- expensive repo calls use `withConcurrencyLimit`
- diagnostics expose `dedupe` and `concurrency.waits`

## Timeout / Fallback Behavior

- `deferred.sessionHints` runs with timeout guard (`90ms`)
- timeout/failure does not block first-render feed cards
- fallback signals:
  - `session_hints_timeout`
  - `session_hints_failed`

## What Is Intentionally Excluded

- full post-detail hydration
- comments/replies trees
- multi-quality media/stream ladders
- neighboring post slices
- non-critical enrichment trees

## Why This Avoids Old Slow Behavior

- strict first-page cap
- lightweight card schema (no full detail x N)
- optional work cannot block base response
- explicit dedupe/concurrency controls reduce startup storm amplification
- payload budgets and diagnostics make bloat visible immediately

## Curl Commands

Set local base URL:

- `export BASE_URL=http://localhost:8080`

Denied/internal-only check:

- `curl -sS "$BASE_URL/v2/feed/bootstrap" | jq`

Successful bootstrap:

- `curl -sS -H "x-viewer-id: internal-viewer" -H "x-viewer-roles: internal" "$BASE_URL/v2/feed/bootstrap" | jq`

Limit boundary:

- `curl -sS -H "x-viewer-id: internal-viewer" -H "x-viewer-roles: internal" "$BASE_URL/v2/feed/bootstrap?limit=8" | jq`

Fallback debug path:

- `curl -sS -H "x-viewer-id: internal-viewer" -H "x-viewer-roles: internal" "$BASE_URL/v2/feed/bootstrap?debugSlowDeferredMs=300" | jq`

Diagnostics verification:

- `curl -sS "$BASE_URL/diagnostics?limit=20" | jq`

## Diagnostics Verification Checklist

For route `feed.bootstrap.get`, verify:

- `routePolicy` exists with `critical_interactive`
- `payloadBytes` populated
- `dbOps` populated
- `cache`, `dedupe`, `concurrency` populated
- `fallbacks` and `timeouts` visible when slow debug path is used
- `budgetViolations` is empty under normal local runs

## Tradeoffs

- this phase favors deterministic lightweight mocks over real ranking/data joins
- recommendation/session richness is deferred to avoid first-paint blocking
- next route should handle feed pagination/detail hydration separately to keep bootstrap lean
