# Comments v2 (Read + Write Surface)

Date: 2026-04-20  
Scope: production-safe top-level comments only.

## CommentSummary Entity

Base entity:

- `commentId`
- `postId`
- `author` (`AuthorSummary`)
- `text`
- `createdAtMs`
- `likeCount` (optional)
- `viewerState` (`liked`, `owned`)

No nested replies in this entity.

## Routes

### `GET /v2/posts/:postId/comments?cursor=...&limit=...`

- routeName: `comments.list.get`
- top-level comments only
- cursor pagination
- default `limit=10`, min `5`, max `20`
- returns:
  - `requestKey`
  - `page.cursorIn`
  - `page.nextCursor`
  - `items` (`CommentSummary[]`)

### `POST /v2/posts/:postId/comments`

- routeName: `comments.create.post`
- creates one top-level comment
- body:
  - `text`
  - optional `clientMutationKey` for idempotency

### `DELETE /v2/comments/:commentId`

- routeName: `comments.delete.delete`
- safe delete by owner
- repeated delete is idempotent no-op

## Pagination Strategy

- cursor encodes `(commentId, createdAtMs)` boundary
- sort is `created_desc`
- no recursive reply loading
- one query per page in repository path

## Fan-out Avoidance

- comments list uses a single repository query per page
- no per-comment secondary DB queries
- author data is returned with row record and cached as shared `AuthorSummary`
- no reply subtree hydration in base route

## Invalidation Rules

On create/delete:

- invalidate `post:{postId}:detail`
- invalidate `post:{postId}:social`
- invalidate deterministic detail route keys
- invalidate deterministic first-page comments list key (`start`, default limit)

Intentionally not invalidated:

- feed/search/profile list caches broadly
- non-deterministic comments list page keys

## Tolerated stale windows

- non-deterministic paged list route caches remain TTL-based to avoid invalidation storms.

## Request-Pressure Safety

- in-flight dedupe on list/create/delete
- mutation locks for create and delete lanes
- concurrency caps on list/create/delete repository lanes
- create idempotency collapses duplicate rapid submit attempts
- route cache collapses repeated same-page reads to near-zero DB ops

## Route Policies / Budgets

- `comments.list.get`
  - priority: `critical_interactive`
  - latency: p50 85ms / p95 190ms
  - db: maxReadsCold 20, maxQueriesCold 1
  - payload: target 12KB, max 24KB
- `comments.create.post`
  - priority: `critical_interactive`
  - latency: p50 80ms / p95 180ms
  - db: maxReadsCold 2, maxQueriesCold 2
  - payload: target 3KB, max 10KB
- `comments.delete.delete`
  - priority: `deferred_interactive`
  - latency: p50 75ms / p95 170ms
  - db: maxReadsCold 2, maxQueriesCold 2
  - payload: target 2.5KB, max 8KB

## Intentionally NOT Supported (this phase)

- nested replies tree API
- reply pagination
- comment edit
- comment like mutation
- realtime listener semantics

## Curl Verification

```bash
curl -sS "http://127.0.0.1:8080/v2/posts/internal-viewer-feed-post-1/comments?limit=5" \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal"
```

```bash
curl -sS -X POST "http://127.0.0.1:8080/v2/posts/internal-viewer-feed-post-1/comments" \
  -H "content-type: application/json" \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal" \
  -d '{"text":"Great place","clientMutationKey":"cmk-001"}'
```

```bash
curl -sS -X DELETE "http://127.0.0.1:8080/v2/comments/<COMMENT_ID>" \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal"
```

```bash
curl -sS "http://127.0.0.1:8080/diagnostics?limit=60"
```

## Diagnostics Verification

For each comments route verify:

- `routeName`
- `routePolicy`
- `dbOps`
- `payloadBytes`
- `dedupe`
- `concurrency`
- `idempotency`
- `invalidation`
- `budgetViolations`
