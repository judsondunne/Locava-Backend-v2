# System Flow Audit (Backend v2)

Date: 2026-04-20  
Scope: Cross-surface combined behavior audit (no new routes/contracts/features).

## Method

- Audited route -> orchestrator -> service -> repository flow for auth/bootstrap/feed/profile/search/comments/notifications/chats/posting/collections.
- Audited dedupe, concurrency, cache, invalidation, timeout/fallback, and idempotency behavior.
- Validated baseline runtime health via `npm test` (24 files, 114 tests passed).

## Cross-Surface Flow Matrix

### 1) App startup (auth/session/bootstrap/feed bootstrap + background surfaces)

Request sequence (typical):

1. `GET /v2/auth/session`
2. `GET /v2/bootstrap`
3. `GET /v2/feed/bootstrap`
4. In parallel/soon after: `GET /v2/notifications`, `GET /v2/chats/inbox`

Overlaps:

- `auth.session` and `bootstrap` both call `loadSession(viewerId)` and dedupe on `session:${viewerId}` (good, same-process collapse).
- Startup fan-in hits independent route caches (`session-v1`, `init-v1`, `feed-bootstrap-v1`, inbox/notifications list keys), so cold-start still creates multi-lane pressure.

Duplicate-call controls:

- In-flight dedupe exists across services.
- Route caches (3-8s TTLs) absorb immediate repeats.

Race conditions:

- No cross-route startup transaction; each route is eventually consistent by design.
- If Firestore is slow, routes can degrade independently and return mixed fallback + source-backed payloads.

Cache and invalidation interactions:

- Startup mostly read-only; invalidation not expected.
- Cross-instance caveat: cache/dedupe are in-memory and process-local.

---

### 2) Feed scroll + detail + like/save/comment

Request sequence:

1. `GET /v2/feed/bootstrap`
2. `GET /v2/feed/page` (cursor chain)
3. `GET /v2/feed/items/:postId/detail`
4. Mutations: `POST /v2/posts/:postId/like|unlike|save|unsave`, `POST /v2/posts/:postId/comments`

Overlaps:

- Page/detail/social/viewer state loaders run concurrently in detail path.
- Feed and profile detail both depend on shared entity keys (`post:*`, `user:*`).

Duplicate-call controls:

- Dedupe keys are per viewer/cursor/post and collapse same-key bursts.
- Entity cache avoids repeated shaping for card/detail/social/viewer state.

Race conditions:

- Mutation vs stale list/detail race is controlled by invalidation after mutation completion.
- Comment create/delete invalidates detail + comments first-page route cache.

Cache/invalidation interactions:

- Strong for first-page hot paths, but invalidation is pattern-based, not exhaustive cursor-scan.
- **Gap:** profile post detail invalidation key currently uses `viewerId` where `userId` is expected for cache key composition, so some profile detail caches can remain stale for non-self profiles.

---

### 3) Profile flow (bootstrap -> grid -> post detail)

Request sequence:

1. `GET /v2/profiles/:userId/bootstrap`
2. `GET /v2/profiles/:userId/grid`
3. `GET /v2/profiles/:userId/posts/:postId/detail`

Overlaps:

- Bootstrap fetches header, relationship, and grid preview; optional badge summary is timeout-bounded.
- Grid/detail reuse `post:*` and `user:*` shared entities.

Duplicate-call controls:

- Dedupe on bootstrap/grid/detail keys.
- Route cache per cursor/limit/user.

Race conditions:

- Follow/unfollow invalidation depends on known-author index from cached post cards; cold-author posts may miss viewer-state invalidation coverage.

Cache/invalidation interactions:

- Generally coherent, but author-post invalidation breadth is bounded by index knowledge/limit.

---

### 4) Search flow (typing users/posts -> open result)

Request sequence:

1. `GET /v2/search/users?q=...`
2. `GET /v2/search/results?q=...`
3. open result -> feed/profile detail routes

Overlaps:

- Typing churn issues parallel unique-query calls; dedupe only helps exact-key repeats.
- Search results hydrate cards through feed batch summary path.

Duplicate-call controls:

- Route cache per normalized query/cursor/limit.
- Service dedupe per normalized query key.

Race conditions:

- No cancellation/backpressure per query stream at backend layer; fast typing can still create many distinct cache misses.

Cache/invalidation interactions:

- Search routes are read-only; invalidation mainly arrives from post mutations affecting shared entities.

---

### 5) Posting flow (session -> media -> finalize -> status)

Request sequence:

1. `POST /v2/posting/upload-session`
2. `POST /v2/posting/media/register` (per asset)
3. `POST /v2/posting/media/:mediaId/mark-uploaded`
4. `POST /v2/posting/finalize`
5. Polling:
   - `GET /v2/posting/media/:mediaId/status`
   - `GET /v2/posting/operations/:operationId`

Overlaps:

- Multi-asset register/status polling can run in parallel.
- Finalize and operation polling can overlap with feed/profile refresh calls.

Duplicate-call controls:

- Strong idempotency keys + mutation locks per session/media/operation.

Race conditions:

- **Important:** feed/profile invalidation for new post happens when `operationstatus` detects completion, not at finalize; if client stops polling, invalidation can be delayed.

Cache/invalidation interactions:

- Invalidation on completion is one-time tracked by `completionInvalidatedAtMs`.
- Poll-based invalidation trigger creates dependency on client poll discipline.

---

### 6) Chat flow (inbox -> thread -> send -> consistency)

Request sequence:

1. `GET /v2/chats/inbox`
2. `GET /v2/chats/:conversationId/messages`
3. `POST /v2/chats/:conversationId/messages`
4. optional `POST /v2/chats/:conversationId/mark-read`

Overlaps:

- Send can race with concurrent thread/inbox refresh.
- Invalidation clears first-page inbox and known thread start-page keys (10/15/20/25/50 variants).

Duplicate-call controls:

- Dedupe + mutation lock per viewer+conversation.
- Idempotency from `clientMessageId` in repository.

Race conditions:

- Other participants' views rely on their own refresh/TTL; no broadcast invalidation path.

Cache/invalidation interactions:

- Local-view coherence is strong for first pages.
- Non-first-page thread cache invalidation remains bounded to known key variants.

---

### 7) Notifications flow (list -> mark read/all read)

Request sequence:

1. `GET /v2/notifications`
2. `POST /v2/notifications/mark-read` or `/mark-all-read`

Overlaps:

- Notification creation from like/comment/follow runs async (`setTimeout`) and can overlap list/mark paths.

Duplicate-call controls:

- mark-read/all-read dedupe + mutation lock per viewer.

Race conditions:

- Async creation is intentionally non-blocking, but failures are swallowed (best-effort behavior).

Cache/invalidation interactions:

- Invalidates first-page route keys for several limits (10/15/20).
- Potential stale window if client uses non-covered limits/cursors.

---

### 8) Collections flow (saved list + save/unsave from other surfaces)

Request sequence:

1. `GET /v2/collections/saved`
2. `POST /v2/posts/:postId/save|unsave` from feed/profile/detail
3. refresh saved list

Overlaps:

- Save/unsave can occur while collections list is actively paginating.

Duplicate-call controls:

- Post mutation dedupe/lock around `post-mutation:${viewerId}:${postId}`.

Race conditions:

- Saved list generation overlays mutation state on default list; coherent within process.

Cache/invalidation interactions:

- Save/unsave invalidates first-page collection cache for selected limit variants (10/12/15/20).
- Deeper pages rely on TTL refresh.

## Cross-Flow Failure + Fallback Audit (Phase 3)

Observed pattern:

- Source adapters are timeout-bounded and fail-open to deterministic/repository fallback.
- Fallback/timeout labels are recorded in request context where fallback occurs in request path.

Consistency outcome:

- No hard-fail requirement for optional/deferred data; routes stay responsive.
- Mixed payload modes (source + fallback) are possible and expected.

Risks:

- Repeated fallback can mask source regressions unless diagnostics are actively monitored.
- Async notification-create path occurs outside request context; fallback/timeout visibility is weaker there.
- Process-local mutable state means restart/scale events can shift behavior.

## Cache + Invalidation Audit (Phase 4)

Strengths:

- Shared entity keys reduce cross-surface drift (`post card/detail/social`, `user summary`, `viewer post state`).
- Mutation invalidation includes entity + route key purges and records invalidation metrics.

Primary gaps:

1. Profile post-detail invalidation key mismatch for non-self profile cache key composition.
2. Invalidation targets are selective first-page key sets; deep cursors depend on TTL.
3. Posting completion invalidation requires operation status polling to execute.
4. Caches are in-memory per instance (no global invalidation bus).

## Diagnostics Completeness Audit (Phase 5)

What is complete:

- Route name assignment in v2 routes.
- Route policy attachment via request context.
- DB ops, payload bytes, cache, dedupe, concurrency, entity cache, idempotency, invalidation metrics.
- Fallback/timeouts visible for request-scoped fallback paths.

Blind spots:

- Async side-effects (`notificationsService.createFromMutation`) run outside request context; diagnostic attribution is partial.
- `DiagnosticsStore` keeps only last 200 records in-memory (not durable, limited for sustained pressure analysis).
- No built-in per-route aggregation/histograms beyond recent list + summary.

## Hidden Gaps (Phase 6)

1. **Must-fix:** profile detail cache invalidation key mismatch can leave stale detail on non-self profiles.
2. **Must-fix:** posting completion invalidation depends on poll; add server-side completion invalidation guarantee independent of client polling.
3. **High risk:** process-local cache/dedupe/locks/invalidation state means multi-instance behavior can diverge.
4. **High risk:** first-page-focused invalidation leaves deeper cursor windows stale until TTL.
5. **Medium risk:** search typing churn can still flood distinct query keys (no server-side cancellation/rate shaping).
6. **Medium risk:** async notification-create/invalidate path is best-effort with swallowed errors.
7. **Operational dependency:** source-of-truth query patterns require proper Firestore composite indexes and stable credentials.

