# Feed Page (Surface)

## Purpose

`GET /v2/feed/page` is the continuation route for feed scrolling after bootstrap.  
It is intentionally lightweight and cursor-driven to stay resilient under repeated scroll requests.

## Route

- `GET /v2/feed/page`

Query:

- `cursor` (optional, format `cursor:<offset>`)
- `limit` (optional, `4-8`, default `5`)

## Contract Summary

Response:

- `routeName: "feed.page.get"`
- `requestKey`
- `page` (`cursorIn`, `limit`, `count`, `hasMore`, `nextCursor`, `sort`)
- `items[]` (aligned with bootstrap item shape)
- `degraded`, `fallbacks`

Item shape intentionally matches bootstrap cards:

- `postId`, `rankToken`
- `author` summary
- `captionPreview`
- `media` (`type`, `posterUrl`, `aspectRatio`, `startupHint`)
- `social` summary
- `viewer` flags
- `updatedAtMs`

## Cursor Strategy

- deterministic ordering by synthetic rank/session order
- cursor is an offset token: `cursor:<offset>`
- first page: no cursor (offset 0)
- next page: cursor advances by page size
- invalid cursor returns `400 invalid_cursor`

## Request-Pressure Safety Strategy

- same-cursor duplicate requests: deduped via in-flight key `feed-page:<viewerId>:<cursorOrStart>:<limit>`
- overlapping adjacent cursor requests: not deduped (different keys), but repository concurrency-capped
- weak-network retries: page-slice cache by `(viewer, cursor, limit)` absorbs repeats
- out-of-order responses: response echoes `cursorIn` + `requestKey` so client can reconcile/ignore stale pages
- no optional enrichment in page path, so no blocking on non-critical work

## Source-of-Truth Status

- candidate retrieval can use Firestore source path (bounded `posts` query, ordered by `createdAtMs desc`)
- selected source fields are minimal (`feedSlot`, `createdAtMs`, `updatedAtMs`)
- strict timeout fallback preserves deterministic path if source is unavailable/slow

Still synthetic in this phase:

- slot-derived post ids and card internals remain on existing shared feed shaping path

## Route Policy and Budgets

Route policy: `feed.page.get`

- priority: `critical_interactive`
- latency: p50 `95ms`, p95 `220ms`
- db ops (cold): max reads `16`, max queries `2`
- db ops (warm expected): reads `0`, queries `0` (cache-hit path)
- payload: target `22,000` bytes, max `40,000` bytes
- cache expectation: `required`
- concurrency expectation: dedupe expected, max concurrent repo ops `4`

## Cache Ownership

- page response cache key: `list:feed-page-v1:<viewerId>:<cursorOrStart>:<limit>` (TTL 6s)
- in-flight dedupe key: `feed-page:<viewerId>:<cursorOrStart>:<limit>`
- repository concurrency lane: `feed-page-repo`

## What This Route Intentionally Does Not Include

- full post detail payloads
- comments payloads
- media ladder fields (stream/mp4 variants)
- heavy nested author/profile enrichment
- recommendation debug trees

## Why This Avoids Old Slow Behavior

- strict limit cap and lightweight shape prevent payload bloat
- duplicate same-page requests do not trigger duplicate backend work
- concurrency caps protect server under fast scroll overlap
- no optional/deferred enrichment means no scroll blocking from side work
- diagnostics expose cache/dedupe/concurrency/payload drift signals

## Curl Commands

Set base URL:

- `export BASE_URL=http://localhost:8080`

Denied/internal-only check:

- `curl -sS "$BASE_URL/v2/feed/page" | jq`

Bootstrap cursor acquisition:

- `curl -sS -H "x-viewer-id: internal-viewer" -H "x-viewer-roles: internal" "$BASE_URL/v2/feed/bootstrap" | jq`

First page:

- `curl -sS -H "x-viewer-id: internal-viewer" -H "x-viewer-roles: internal" "$BASE_URL/v2/feed/page?limit=5" | jq`

Next page with cursor:

- `curl -sS -H "x-viewer-id: internal-viewer" -H "x-viewer-roles: internal" "$BASE_URL/v2/feed/page?limit=5&cursor=cursor:5" | jq`

Max limit test:

- `curl -sS -H "x-viewer-id: internal-viewer" -H "x-viewer-roles: internal" "$BASE_URL/v2/feed/page?limit=8" | jq`

Invalid cursor test:

- `curl -sS -H "x-viewer-id: internal-viewer" -H "x-viewer-roles: internal" "$BASE_URL/v2/feed/page?cursor=bad-cursor" | jq`

Diagnostics:

- `curl -sS "$BASE_URL/diagnostics?limit=20" | jq`

## Diagnostics Verification Checklist

For route `feed.page.get`, verify:

- `routePolicy` populated
- `payloadBytes` recorded
- `dbOps` recorded
- `cache`, `dedupe`, `concurrency` populated
- `budgetViolations` empty for normal page limits

## Tradeoffs

- route is intentionally simple and non-recommendation-heavy in this phase
- synthetic cursor format is clear and strict but not opaque/signed yet
- detail hydration remains a separate future route to preserve lean pagination
- source-backed candidates improve realism, but full feed source parity still requires detail path integration
