# Mutations + Invalidation Discovery (v2)

Date: 2026-04-20

## Critical Mutations (Phase Scope)

1. `POST /v2/posts/:postId/like`
2. `POST /v2/users/:userId/follow`

These are the highest-impact consistency mutations across feed/profile/search/detail surfaces.

## Shared Entities Affected

### Post like/unlike

- `post:{postId}:social` (`SocialSummary`)
- `post:{postId}:card` (`PostCardSummary`)
- `post:{postId}:detail` (`PostDetail`)
- `post:{postId}:viewer:{viewerId}:state` (`ViewerPostState`)

### User follow/unfollow

- `user:{userId}:summary` (`AuthorSummary`)
- viewer-scoped post state keys for authored posts (bounded): `post:{postId}:viewer:{viewerId}:state`

## Current Risks (Pre-Mutation System)

- Entity cache keys can remain stale after write events.
- Route cache payloads can preserve stale embedded entities for TTL windows.
- Cross-surface consistency can drift (feed/search/profile/detail showing different like/follow state).
- Naive broad invalidation can create invalidation storms and induce recomputation cascades.

## Invalidation Strategy Requirements

- Invalidate only entity keys directly tied to mutated entity semantics.
- Keep route cache invalidation targeted only where key is deterministic.
- Never flush all caches, never rebuild full feed/search/profile synchronously.
- Bound follow invalidation fanout by known authored-post index with cap.

## What This Phase Intentionally Avoids

- Large synchronous downstream recomputation jobs.
- Full route graph invalidation on each mutation.
- Eager feed/search/profile recomposition.
