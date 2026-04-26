# Entity Cache Strategy (v2)

This document defines the canonical entity cache layer used across feed/profile surfaces.

## Goals

- Reuse shaped entities across routes.
- Reduce duplicate DB reads and duplicate CPU shaping.
- Keep route cache and entity cache separate.

## Layering

- **Entity cache layer:** stores reusable shared entities (`post card`, `post detail`, `social`, `author summary`, `viewer post state`).
- **Route cache layer:** stores assembled route payloads with route-specific paging/split structure.
- **Dedupe layer:** wraps loaders to collapse concurrent calls per key.

Flow:
1. Service checks entity cache.
2. On miss, service loads from repository.
3. Service shapes entity once.
4. Service stores entity in cache.
5. Orchestrator composes route response from shared entities.

## Canonical Cache Keys

- `post:{postId}:card`
- `post:{postId}:detail`
- `post:{postId}:social`
- `user:{userId}:summary`
- `post:{postId}:viewer:{viewerId}:state`

## Diagnostics

Entity cache diagnostics are request-scoped and emitted in `/diagnostics`:

- `entityCache.hits`
- `entityCache.misses`
- `entityConstruction.total`
- `entityConstruction.types`

These metrics expose whether we are reusing entities or rebuilding them repeatedly.

## Current Integration Points

- Feed service entity loaders for card/detail/author/social/viewer-state.
- Profile service grid/bootstrap canonical card priming.
- Profile post-detail service canonical detail/author/social/viewer-state caching.

## Guardrails

- Keep TTLs short and explicit; prefer stale-safe lightweight entities.
- Never cache route-only wrappers as entity cache entries.
- Keep cache keys semantic and stable; avoid viewer-agnostic keys for viewer-specific state.

## Tradeoff Notes

- Entity cache improves reuse but can increase memory pressure if key cardinality is uncontrolled.
- Viewer-specific keys are intentionally narrow (state only) to avoid cross-viewer leakage.
- Route-level cache still matters for full response replay and should remain in place.
