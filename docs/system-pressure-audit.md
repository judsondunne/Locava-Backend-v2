# System Pressure Audit (Backend v2)

Date: 2026-04-20  
Scope: Combined-route pressure behavior under realistic concurrent usage.

## Pressure Model

This backend currently relies on:

- per-request dedupe (`dedupeInFlight`)
- per-lane concurrency caps (`withConcurrencyLimit`)
- route/list/entity in-memory cache
- selective mutation invalidation
- timeout + fail-open fallback on source adapters

These are effective within a single process, but not globally coordinated across instances.

## Hotspot Analysis

## 1) Startup/resume overlap

Concurrent routes:

- `/v2/auth/session`
- `/v2/bootstrap`
- `/v2/feed/bootstrap`
- often `/v2/notifications`, `/v2/chats/inbox`

Pressure risks:

- Burst of cold cache misses across multiple lanes on resume.
- Route-level caches are short TTL; repeated app foreground cycles can still trigger bursts.

Mitigations present:

- same-key dedupe in auth/bootstrap session lookup.
- lane caps on auth/feed/notifications/chats repositories.

Residual risk:

- Multi-instance traffic can duplicate cold-start load due to non-shared cache/dedupe.

## 2) Feed + notifications + chats parallel load

Pressure vectors:

- Three independent list surfaces, each with page/list cache and user-summary enrichment.
- Shared `user:*` entity cache reduces repeated actor/user shaping.

Residual risks:

- Independent list caches still miss together on first hit.
- Invalidation from chat/notification mutations targets common first-page keys and can cause repeated first-page recache under active use.

## 3) Posting + feed/profile refresh overlap

Pressure vectors:

- Polling routes (`posting operation/media status`) can run while feed/profile refresh occurs.
- Media register/status can fan out per asset.

Residual risks:

- No server-enforced poll minimum; aggressive clients can over-poll.
- Completion invalidation attached to operation-status read path creates extra dependency and potential delayed refresh if polling behavior is erratic.

## 4) Chat send + thread refresh overlap

Pressure vectors:

- send mutation plus immediate inbox/thread reloads.
- cache invalidation clears first-page inbox + selected thread start keys.

Residual risks:

- Non-covered cursor/limit combinations can remain stale until TTL.
- Other participant views update on their own refresh cycle (eventual consistency window).

## 5) Search typing churn

Pressure vectors:

- distinct query values produce distinct dedupe/cache keys.
- rapid user typing can issue many unique misses.

Mitigations present:

- per-query dedupe for exact repeats.
- route cache for repeated normalized query.
- repository scan caps and query limits.

Residual risks:

- no backend cancellation of superseded query chains.
- no explicit backend query throttling by viewer/session.

## Cache Miss Stacking Risk

Where misses can stack:

1. cold startup across auth/bootstrap/feed/inbox/notifications
2. feed detail cold open (card + social + viewer + detail + author + deferred preview)
3. search results/users during fast query churn
4. post-mutation immediate re-open when route cache was just invalidated

Assessment: controlled in-process; vulnerable under horizontal scale or sustained churn.

## Invalidation Cascade Risk

Low-to-moderate cascades:

- like/save/comment invalidate entity keys + selected route keys.
- chat send invalidates multiple inbox/thread start keys.
- notification mutations invalidate selected first-page keys.

No full-cache clears observed; invalidation is targeted.  
Main risk is *coverage gaps* (deep cursors, alternate limits), not broad storms.

## Retry/Poll Amplification Risk

Observed amplification opportunities:

- posting operation/media polling has recommended interval, but no enforced backoff.
- retry endpoints are lock-protected, but repeated client retries can still increase operation churn.

Recommended hardening:

- enforce minimum poll interval server-side or clamp poll rate per operation/media ID.
- add diagnostics counters for poll-frequency anomalies.

## Failure/Fallback Pressure Behavior

When source slows/fails:

- adapters timeout quickly and fallback to deterministic path.
- some adapters temporarily disable source for 5s after timeout (good anti-thrashing behavior).

Residual risk:

- sustained source degradation can produce repeated fallback use with mixed data modes.
- if diagnostics monitoring is not active, fallback-heavy operation may go unnoticed.

## Request Storm Scenarios (Ranked)

1. **Startup storm across instances** (non-shared cache/dedupe)
2. **Search typing storm** (high unique query churn)
3. **Posting poll storm** (client over-polling without server clamp)
4. **Post-mutation refetch storm** (invalidation + immediate cross-surface refresh loops)
5. **Chat send/read refresh burst** (thread/inbox mutual refresh under active messaging)

## Recommended Pressure Guardrails (No Feature Expansion)

1. Add server-side minimum poll interval enforcement for posting status endpoints.
2. Expand invalidation key coverage beyond first-page common limits, or add explicit stale markers for deep pages.
3. Add per-viewer query rate telemetry for search routes.
4. Add multi-instance note/plan for cache + lock + invalidation coherence before external cutover.
5. Add fallback-rate alert thresholds (`fallbacks[]`/`timeouts[]` frequency by routeName).

