# Collections Saved v2 (First Safe Slice)

Date: 2026-04-20  
Scope: saved posts only (read page + save/unsave mutations).

## Entity Model

Read items reuse canonical shared entity:

- `PostCardSummary`

No new heavy collection entity is introduced in this phase.

## Route Definitions

### `GET /v2/collections/saved?cursor&limit`

- routeName: `collections.saved.get`
- query:
  - `cursor?`
  - `limit` (6..20, default 12)
- response:
  - `requestKey`
  - `page.cursorIn`, `page.nextCursor`, `page.hasMore`, `page.limit`, `page.count`
  - `page.sort = saved_at_desc`
  - `items[]` (`PostCardSummary`)

### `POST /v2/posts/:postId/save`

- routeName: `posts.save.post`
- idempotent mutation
- returns `saved=true` and scoped invalidation summary

### `POST /v2/posts/:postId/unsave`

- routeName: `posts.unsave.post`
- idempotent mutation
- returns `saved=false` and scoped invalidation summary

## Pagination Strategy

- cursor encodes `{ id, createdAtMs }` where `createdAtMs` is `savedAtMs`
- sort is strict `saved_at_desc` with id tie-break
- no offset paging

## Request-Pressure Strategy

- strict page bounds (max 20)
- one bounded saved-list repository query path per page
- post cards loaded through shared feed batch card path (no per-item detail fan-out)
- route cache key: `collections-saved-v1:{viewer}:{cursorPart}:{limit}`
- in-flight dedupe key: `collections-saved:{viewer}:{cursorPart}:{limit}`
- concurrency cap: `collections-saved-repo` lane max 8
- mutation dedupe + mutation lock prevent duplicate save/unsave writes per `(viewer,post)`

## Invalidation Rules

`post.save` and `post.unsave` invalidate only scoped keys:

- entity keys:
  - `post:{postId}:social`
  - `post:{postId}:card`
  - `post:{postId}:detail`
  - `post:{postId}:viewer:{viewerId}:state`
- deterministic route detail keys:
  - feed item detail `(viewer, post)`
  - profile post detail `(viewer, post)`
- collections first page route keys only:
  - `collections-saved-v1:{viewer}:start:10`
  - `collections-saved-v1:{viewer}:start:12`
  - `collections-saved-v1:{viewer}:start:15`
  - `collections-saved-v1:{viewer}:start:20`

Intentionally no broad feed/profile/search/list flushes.

## Route Policies

- `collections.saved.get`
  - priority: `critical_interactive`
  - latency: p50 90ms, p95 200ms
  - dbOps: reads<=20, queries<=2
  - payload: target 15KB, max 30KB
  - cache expectation: `required`
  - concurrency expectation: dedupe expected, max repo ops 8
- `posts.save.post`
  - priority: `critical_interactive`
  - latency: p50 70ms, p95 180ms
  - dbOps: reads<=1, queries<=1
  - payload: target 2.5KB, max 8KB
  - cache expectation: `optional`
  - concurrency expectation: dedupe expected, max repo ops 8
- `posts.unsave.post`
  - priority: `critical_interactive`
  - latency: p50 70ms, p95 180ms
  - dbOps: reads<=1, queries<=1
  - payload: target 2.5KB, max 8KB
  - cache expectation: `optional`
  - concurrency expectation: dedupe expected, max repo ops 8

## Diagnostics Verification

Use `/diagnostics?limit=...` and verify:

- `routeName`
- `routePolicy`
- `payloadBytes`
- `dbOps`
- `cache`
- `dedupe`
- `concurrency`
- `invalidation` (save/unsave)
- `budgetViolations` (expected empty)

## Intentionally Not Implemented Yet

- multi-collection create/edit/delete
- collaborator management
- generated/system-mix collection surfaces
- collection detail/media hydration routes
- cover upload/update flows
- map/directory collection expansions

## Tradeoffs

- this slice prioritizes save-state consistency and bounded request pressure over full collections feature breadth
- first-page-only route invalidation accepts bounded stale windows on non-first cursors to prevent invalidation storms
