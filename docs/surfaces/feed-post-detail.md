# Feed Post Detail (Surface)

## Purpose

`GET /v2/feed/items/:postId/detail` hydrates a single selected feed item for viewer open while preserving lean bootstrap/page routes.

## Route

- `GET /v2/feed/items/:postId/detail`

Query:

- `debugSlowDeferredMs` (optional, `0-2000`, default `0`)

## Contract Summary

Response:

- `routeName: "feed.itemdetail.get"`
- `firstRender.post` (`PostDetail` with embedded `cardSummary`)
- `firstRender.author` (`AuthorSummary`)
- `firstRender.social` (`SocialSummary`)
- `firstRender.viewer` (`ViewerPostState`)
- `deferred.commentsPreview` (nullable)
- `background.prefetchHints`
- `degraded`, `fallbacks`

## First Render / Deferred / Background

- **First-render:** single selected post open payload + shared summaries.
- **Deferred:** comments preview (timeout/fallback guarded).
- **Background:** optional prefetch hints only.

## Shared Entity Reuse

- `PostCardSummary`, `AuthorSummary`, `SocialSummary`, `ViewerPostState`, `PostDetail`
- prevents separate conflicting post/author/social shapes across feed routes.
- keeps bootstrap/page/detail contracts connected without overfetching.

## Source-of-Truth Status

- detail first-render bundle is now source-capable with bounded Firestore reads
- adapter path resolves:
  - selected post detail fields
  - author summary doc
  - bounded viewer liked/saved state docs
- strict timeout + deterministic fallback remains
- cache/dedupe/invalidation coherence remains in place

Exact source strategy:

- parse slot from `:postId` (`...-feed-post-{slot}`)
- query `posts` by `feedSlot` with `limit(1)` and narrow selected fields
- read `users/{authorId}` summary fields
- read `posts/{postDocId}/likes/{viewerId}`
- read `users/{viewerId}/savedPosts/{postDocId}`

No neighboring post fetches or unbounded list reads.

## Route Policy and Budgets

Route policy: `feed.itemdetail.get`

- priority: `critical_interactive`
- latency: p50 `105ms`, p95 `230ms`
- db ops (cold): max reads `9`, max queries `6`
- payload: target `24,000` bytes, max `42,000` bytes
- cache expectation: `required`
- concurrency expectation: dedupe expected, max concurrent repo ops `4`

## Cache Ownership

- detail response cache: `entity:feed-item-detail-v1:<viewerId>:<postId>` (TTL 8s)
- shared fragment loads (service dedupe + concurrency lanes):
  - `feed-post-card-summary:<viewerId>:<postId>`
  - `feed-author-summary:<authorUserId>`
  - `feed-social-summary:<postId>`
  - `feed-viewer-post-state:<viewerId>:<postId>`
  - `feed-post-detail:<viewerId>:<postId>`

## Dedupe / Concurrency Strategy

- in-flight dedupe per entity key prevents duplicate same-post work.
- repository lanes have explicit concurrency caps.
- diagnostics exposes `dedupe` and `concurrency` fields.

## Timeout / Fallback Behavior

- deferred comments preview timeout: `90ms`
- timeout/failure fallback markers:
  - `comments_preview_timeout`
  - `comments_preview_failed`
  - `feed_detail_firestore_fallback`
  - `feed_detail_firestore`
- base open path still returns fast.

## What This Route Intentionally Does Not Include

- neighboring post slices
- full comments tree
- liker lists
- heavy author profile payloads
- unrelated recommendation trees

## Why This Avoids Old Slow Behavior

- keeps open path single-item and bounded
- reuses shared summary entities instead of reshaping repeatedly
- dedupes same-post opens during rapid taps
- isolates optional comments from critical open latency
- keeps payload budgets explicit and diagnosable
- prevents source fan-out via fixed-count bundle reads and in-flight detail-bundle sharing

## Curl Commands

Set base URL:

- `export BASE_URL=http://localhost:8080`

Denied/internal-only check:

- `curl -sS "$BASE_URL/v2/feed/items/internal-viewer-feed-post-6/detail" | jq`

Successful detail open:

- `curl -sS -H "x-viewer-id: internal-viewer" -H "x-viewer-roles: internal" "$BASE_URL/v2/feed/items/internal-viewer-feed-post-6/detail" | jq`

Optional fallback path:

- `curl -sS -H "x-viewer-id: internal-viewer" -H "x-viewer-roles: internal" "$BASE_URL/v2/feed/items/internal-viewer-feed-post-6/detail?debugSlowDeferredMs=300" | jq`

Diagnostics:

- `curl -sS "$BASE_URL/diagnostics?limit=20" | jq`

## Diagnostics Verification Checklist

For `feed.itemdetail.get` verify:

- `routePolicy` present
- `payloadBytes` present
- `dbOps` present
- `cache`, `dedupe`, `concurrency` present
- fallback/timeouts visible on debug slow path
- `budgetViolations` empty in normal path

## Tradeoffs

- single-item contract prioritized over adjacent-context hydration
- comments are preview-only in deferred stage
- detail remains lean enough for quick open under weak networks
- source detail path depends on indexed/available source docs; fallback remains important during rollout
