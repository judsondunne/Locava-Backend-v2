# Mutations + Invalidation (v2)

## Implemented Mutation Routes

- `POST /v2/posts/:postId/like`
- `POST /v2/posts/:postId/unlike`
- `POST /v2/users/:userId/follow`
- `POST /v2/users/:userId/unfollow`
- posting completion invalidation via backend completion transition (with status-read fallback)
- `POST /v2/notifications/mark-read`
- `POST /v2/notifications/mark-all-read`
- `POST /v2/chats/:conversationId/mark-read`

Both are internal-gated and return minimal confirmation payloads plus invalidation summary.

## Central Invalidation Helper

- File: `src/cache/entity-invalidation.ts`
- API: `invalidateEntitiesForMutation({ mutationType, ...ids })`
- Responsibilities:
  - map mutation type to exact cache keys
  - batch delete scoped keys
  - record invalidation diagnostics
  - avoid broad route/list cache flushing

## Invalidation Rules

### `post.like`

Invalidates:

- `post:{postId}:social`
- `post:{postId}:card`
- `post:{postId}:detail`
- `post:{postId}:viewer:{viewerId}:state`

Targeted route-detail cache keys are also invalidated when deterministic (detail caches by viewer/post).

### `post.unlike`

Invalidates same key set as `post.like`:

- `post:{postId}:social`
- `post:{postId}:card`
- `post:{postId}:detail`
- `post:{postId}:viewer:{viewerId}:state`
- deterministic detail route-cache keys

### `user.follow`

Invalidates:

- `user:{userId}:summary`
- `post:{postId}:viewer:{viewerId}:state` for known authored posts (bounded cap)

No global feed/search/profile cache flush is performed.

### `user.unfollow`

Invalidates same key set as `user.follow`:

- `user:{userId}:summary`
- bounded authored-post viewer state keys for the acting viewer

### `posting.complete`

Triggered once when a posting operation transitions into `completed` through backend-driven completion handling.
Status polling path remains a fallback to guarantee eventual application.

Invalidates:

- `post:{postId}:social`
- `post:{postId}:card`
- `post:{postId}:detail`
- `post:{postId}:viewer:{viewerId}:state`
- deterministic route-detail cache keys for:
  - feed item detail `(viewer, post)`
  - profile post detail `(viewer, post)`

Intentionally does not invalidate feed/search/profile list caches.

### `notification.create`

Triggered asynchronously from changed mutations:

- `post.like`
- `comment.create`
- `user.follow`

Invalidates:

- notifications route cache keys for affected viewer via route-cache tag:
  - `route:notifications.list:{viewer}`

### `notification.markread`

Invalidates same key set as `notification.create`:

- notifications route cache keys by viewer tag
- unread count view path (same scoped notifications key family)

### `notification.markallread`

Invalidates same key set as `notification.create`:

- notifications route cache keys by viewer tag
- unread count view path (same scoped notifications key family)

### `chat.markread`

Invalidates:

- chats inbox route cache keys for acting viewer via tag:
  - `route:chats.inbox:{viewer}`

### `chat.sendtext`

Invalidates:

- chats thread route cache keys for acting viewer + conversation:
  - `route:chats.thread:{viewer}:{conversation}`
- chats inbox route cache keys:
  - `route:chats.inbox:{viewer}`

## Cache Key Strategy

- Entity cache remains canonical source for shared entity reuse.
- Invalidation is key-scoped and mutation-specific.
- Route caches are preserved unless deterministic targeted invalidation is possible.

## Why This Avoids Stale Data + Overload

- Stale entity fragments are removed immediately after mutation.
- Read routes naturally rebuild only on next demand.
- No synchronous fan-out recomputation of feed/search/profile.
- Follow invalidation uses a bounded authored-post index to prevent invalidation storms.
- Posting completion invalidation is one-time and detail-scoped to avoid publish-time fanout storms.

## Idempotency + Overlap Safety

- State-aware no-op detection marks repeated equivalent requests as idempotent (no invalidation work).
- Equivalent duplicate requests are deduped in-flight.
- Opposite mutations (like/unlike, follow/unfollow) are serialized per resource key to avoid race churn.
- Diagnostics capture idempotency hits/misses.

## Route-Cache Coherence Rules

Directly invalidated (deterministic, cheap):

- feed item detail route-cache key for `(viewer, post)`
- profile post detail route-cache key for `(viewer, post)`
- tagged list route caches for notifications/chats/comments/collections by scoped viewer/resource tags

Intentionally not broadly invalidated:

- feed/search/profile list route caches across variable cursor/query/limit spaces
- posting completion does not trigger broad list cache flushes

These stale windows are accepted and bounded by TTL and capped tagged invalidation (`max 128 keys per mutation call`) to preserve read-path performance and avoid invalidation storms.

## Diagnostics

Each mutation request exposes:

- `routeName`
- `routePolicy`
- latency / payload / `dbOps`
- `invalidation.keys`
- `invalidation.entityKeys`
- `invalidation.routeKeys`
- `invalidation.types`
- `idempotency.hits`
- `idempotency.misses`
- standard cache/dedupe/concurrency/entity cache metrics

## Tradeoffs

- Some route-level cached pages may remain stale until TTL if not deterministically key-addressable.
- Follow invalidation fanout is bounded by known post index; very old/unknown authored posts are refreshed lazily on next read.
- Newly completed posts may not appear instantly in list caches; detail/entity freshness is prioritized over broad cache churn.
