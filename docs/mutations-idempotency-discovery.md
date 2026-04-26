# Mutations Idempotency Discovery (v2)

Date: 2026-04-20

## Current Behavior Findings

1. **Repeated like**
   - State was naturally idempotent for logical outcome (`liked=true`) but still executed write path/invalidation.

2. **Repeated follow**
   - Same as like: logical state stable, but duplicate requests still incurred work.

3. **Fast like then unlike overlap**
   - Without cross-operation serialization, overlapping opposite operations could interleave and cause inconsistent short windows.

4. **Route-cache stale windows**
   - Entity invalidation existed, but route-cache coherence remained narrow to only a few deterministic detail keys.
   - Feed/search list caches could remain stale until TTL (intentional for performance).

## Deterministic Route-Cache Keys Worth Invalidating

Cheap + deterministic:

- `entity:feed-item-detail-v1:{viewerId}:{postId}`
- `entity:profile-post-detail-v1:{viewerId}:{postId}:{viewerId}`

Not cheaply deterministic enough for broad write-time invalidation:

- feed/page/search list cache keyspace across variable query/cursor/limits

## Lightweight Idempotency Strategy Chosen

Combination strategy:

- **state-aware no-op detection** at mutation-state repository (`changed` boolean)
- **per-resource mutation locks** to serialize overlapping opposite operations:
  - post mutations lock key: `{viewerId}:{postId}`
  - follow mutations lock key: `{viewerId}:{userId}`
- **dedupe** for identical in-flight requests remains in place

This avoids duplicate effective writes and stabilizes overlapping mutation order without heavy infrastructure.

## Acceptable Remaining Stale Windows

- Some route-level list caches (feed/search/profile pagination/bootstraps) may remain stale until TTL.
- This is accepted to preserve read-path performance and avoid invalidation storms.
- Entity-level coherence and deterministic detail-route coherence are tightened immediately on mutation.
