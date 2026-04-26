# System Stabilization Fixes (Part A)

Date: 2026-04-20  
Scope: Must-fix blockers from system readiness audit.

## A1. Implemented Fixes

## A) Profile post-detail invalidation key mismatch

Issue:

- profile post-detail route cache key is `entity:profile-post-detail-v1:{profileUserId}:{postId}:{viewerId}`
- invalidation previously targeted `...:{viewerId}:{postId}:{viewerId}`, which misses non-self profile cases.

Fix:

- Updated invalidation to derive profile detail keys using:
  - known post->author index (`getKnownAuthorUserIdForPost`)
  - parsed `{profileUserId}` prefix from `{postId}` when available (`{userId}-post-*`)
  - viewer fallback candidate
- Invalidation now deletes all derived candidate keys safely and remains scoped.

Verification:

- Added test: `v2/mutations.routes.test.ts` -> `invalidates non-self profile post detail cache keys correctly`.

## B) Posting completion invalidation polling dependency

Issue:

- completion invalidation only occurred when `GET /v2/posting/operations/:id` was polled and observed completed state.

Fix:

- Added backend-driven completion invalidation scheduling in `PostingMutationService`:
  - on finalize, schedule one background completion check per operation
  - perform scoped `posting.complete` invalidation + mark completion invalidated
  - polling path still keeps fallback safety for missed background execution
- Result: completion invalidation no longer relies solely on client poll cadence.

Verification:

- Added test: `v2/posting.routes.test.ts` -> `applies completion invalidation even before the first client status poll`.

## C) Deeper-page / variable-limit invalidation coverage

Issue:

- invalidation logic was hardcoded to first-page start cursors and a small set of limits.

Fix:

- Added route-cache indexing and tag-based invalidation:
  - `src/cache/route-cache-index.ts`
  - `src/cache/route-cache.ts`
- Updated list orchestrators to register route cache keys by semantic tags:
  - comments
  - notifications
  - chats inbox
  - chats thread
  - collections saved
- Updated mutation invalidation to use tag-based route invalidation for:
  - `comment.create`, `comment.delete`
  - `notification.*`
  - `chat.markread`, `chat.sendtext`
  - `post.save`, `post.unsave` (collections route)

Bounded pressure guardrails:

- max keys tracked per tag: 256
- max keys invalidated per mutation call: 128

Verification:

- Added tests proving deep cached pages are invalidated (not just first page):
  - notifications
  - chats inbox + thread
  - comments
  - collections saved

## D) Multi-instance coherence strategy (smallest safe improvement + seam)

Issue:

- process-local assumptions were implicit.

Fix:

- Added explicit coherence mode and visibility seam:
  - env: `COHERENCE_MODE=process_local|external_coordinator_stub`
  - runtime status helper: `src/runtime/coherence.ts`
  - surfaced in `/ready` and `/diagnostics`
- Added explicit alert marker in diagnostics when process-local mode is active:
  - `process_local_coherence_mode`

Outcome:

- behavior is still process-local by default (no giant infra build in this phase),
- but operational posture is now explicit and externally observable.

## E) Fallback/timeout operational hardening

Fix:

- Added operational signal aggregation in diagnostics store:
  - fallback count/rate
  - timeout count/rate
  - top fallback routes
  - alert thresholds:
    - fallback rate >= 15% over sample >= 20 -> `fallback_rate_high`
    - timeout rate >= 10% over sample >= 20 -> `timeout_rate_high`
- Added these fields to `/diagnostics` response and included alerts array.

Verification:

- Added test in `createApp.test.ts` ensuring diagnostics expose coherence and operational signals.

## A2. Verification Summary

Test/build:

- `npm test` -> 121 passing
- `npm run build` -> success

Targeted curl checks validated:

- profile non-self detail invalidation refreshes cache
- posting completion invalidation applies without pre-poll
- deeper notification cursor page invalidated after mutation
- diagnostics now expose coherence and operational signals

## Remaining Risk (Post-Fix)

- Multi-instance behavior is still process-local unless external coordinator mode is implemented and wired.
- Tag-based invalidation is bounded and scoped, but still eventual-consistency for untouched families outside current tags.
- Fallback alerts are in diagnostics response; production alert plumbing still depends on external monitoring integration.

