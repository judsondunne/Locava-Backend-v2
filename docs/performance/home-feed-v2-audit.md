# Home Feed V2 Audit and Hardening Plan

## Scope

Audited current Home feed behavior across:

- Backend: `Locava Backendv2`
- Native: `Locava-Native`
- Surfaces: For You and Following

This document is phase-1 audit first (no behavior changes in this section), then phase-2 design.

## Current Route Mapping (Exact)

### For You startup (Native -> Backend)

- Native entrypoint: `src/features/home/reels/ReelsBootstrapContext.tsx`
- Owner path: `src/features/home/backendv2/feedV2.owner.ts`
- Repository call: `feedV2Repository.forYouPage(...)`
- Wire endpoint: `GET /v2/feed/for-you`
- Backend route: `src/routes/v2/feed-for-you.routes.ts`

### For You pagination (Native -> Backend)

- Same owner/repository as startup, but with cursor
- Repository call: `feedV2Repository.forYouPage({ cursor })`
- Wire endpoint: `GET /v2/feed/for-you?cursor=...`

### Following startup (Native -> Backend)

- Native entrypoint: `src/features/home/feeds/useFollowingBootstrap.ts`
- Repository call (v2 enabled): `feedV2Repository.bootstrap({ tab: 'following' })`
- Wire endpoint: `GET /v2/feed/bootstrap?tab=following`
- Backend route: `src/routes/v2/feed-bootstrap.routes.ts`

### Following pagination (Native -> Backend)

- Native entrypoint: `src/features/home/feeds/useFollowingBootstrap.ts`
- Repository call (v2 enabled): `feedV2Repository.page({ tab: 'following', cursor })`
- Wire endpoint: `GET /v2/feed/page?tab=following&cursor=...`
- Backend route: `src/routes/v2/feed-page.routes.ts`

## Served/Seen Tracking and Write Behavior

### For You

- Uses served tracking in `users/{viewerId}/feedServed/{postId}`.
- Served checks are bounded to candidate ids via `fetchServedPostIds(viewerId, candidatePostIds)`.
- Served writes are only for returned posts (`writeServedPosts` with one batch commit).
- Route emits summary log `event: "feed_for_you_fast_summary"`.

### Following

- No per-item served write path currently in `/v2/feed/bootstrap` and `/v2/feed/page` for following tab.
- Following currently relies on candidate filtering by author/fallback behavior, not served suppression.

## Risk Audit Matrix

### For You (`GET /v2/feed/for-you`)

- Empty too early risk: **medium**
  - Good: recycles real served posts as fallback before empty.
  - Risk: `exhausted` determination can still become true when first windows are out and cursor advances without broader recovery.
- Large Firestore reads risk: **medium**
  - Candidate windows are bounded, but soft read budgets are `80/120` and route policy still allows larger cold budgets.
  - Served-check read estimate currently adds full candidate count in service debug, while repository also performs getAll reads.
- Offset pagination: **no** (uses structured `fy:v2:` cursor, not offset scans).
- Unbounded loops/oversampling: **no hard unbounded loop**, but has multi-window fetch pattern (`reel` + `regular` + fallback regular) that can still push high reads in poor inventory shapes.
- Detail hydration blocking first visible posts: **no** on For You V2 path.
  - Feed returns render-ready cards.
  - Detail batch in Native is delayed and capped to 2 ids in `ReelsFeedHeavy`.

### Following (`GET /v2/feed/bootstrap?tab=following`, `GET /v2/feed/page?tab=following`)

- Empty too early risk: **high**
  - Uses offset-style cursor from shared feed stack and may return empty bounded windows with `hasMore` false while inventory still exists outside current bounded fetch.
- Large Firestore reads risk: **high**
  - Uses shared `FeedFirestoreAdapter.getFeedCandidatesPage` with offset semantics and chunk scans.
  - Following path can hit:
    - fanout collection read
    - post lookup by ids
    - chunked author `in` queries
    - global fill query
  - This can be query-heavy across pages.
- Offset pagination: **yes**
  - `cursor:<offset>` and encoded `fc:v1:` offset cursor are still in use for following route family.
- Unbounded loops/oversampling: **bounded but heavy**
  - No literal infinite loop, but scan/fill behavior can do repeated query chunks to satisfy required candidate count.
- Detail hydration blocking first visible posts: **not strictly blocked**, but following currently starts large uncapped detail hydration on all uncached ids on each change, increasing startup contention.

## Native Integration Audit

### For You old-route safety

- Good:
  - `feedV2.repository.ts` hardcodes For You to `/v2/feed/for-you`.
  - Dev guards throw if explore attempts `/v2/feed/bootstrap` or `/v2/feed/page`.
  - Model test exists: `feedForYouV2.repository.model.test.ts`.
- Risk:
  - Legacy `useReelsBootstrap` path (non-v2 mode) still contains old for-you bootstrap API behavior; must ensure v2 mode remains default and guarded.

### For You hasMore/early no-more behavior

- Current normalization: `hasMore = !exhausted && Boolean(nextCursor || items.length > 0)`.
- Risk: when backend returns `items.length > 0` but `nextCursor === null` and `exhausted === false`, Native still sets `hasMore = true` (can trigger pagination attempts without cursor).
- Owner mitigates this by requiring `nextCursor` for pagination, but state can still be semantically inconsistent.

### Following endpoint usage

- Uses `/v2/feed/bootstrap` + `/v2/feed/page` with `tab=following`.
- Does not yet use a dedicated following-v2 route.

### Duplicate guard scope

- For You page-level dedupe exists in `explorePosts.api.ts`.
- Following dedupe in UI currently uses `dedupeReelsItemsByPostId` over merged list; no explicit per-tab scoped duplicate registry across pagination generations.

### Cursor format risks

- Legacy cursor formats still present and expected in codepaths:
  - `cursor:<offset>`
  - `fc:v1:<base64>`
- For You path warns when seeing legacy cursor strings.
- Following path is still powered by those legacy offset cursor forms.

### "No more posts" decision points (all found)

- Native For You:
  - `feedV2.normalize.ts` in `normalizeFeedForYouPage`
  - `feedV2.owner.ts` gate: `if (!nextCursor || !hasMore) return`
- Native Following:
  - `useFollowingBootstrap.ts` `getNextPageParam: lastPage.nextCursor ?? undefined`
  - FlatList decisions based on `hasNextPage` from React Query
- Backend For You:
  - `FeedForYouService` sets `exhausted`
- Backend Following/shared:
  - `FeedFirestoreAdapter.getFeedCandidatesPage` determines `hasMore/nextCursor`
  - `FeedPageOrchestrator` forwards page `hasMore/nextCursor`

## Key Findings Summary

1. For You is already close to desired architecture (bounded windows + served filtering + recycled real posts), but needs stricter budgets, cursor/debug cleanup, and ranking version bump.
2. Following currently rides legacy shared feed bootstrap/page stack with offset cursor semantics and fallback/global-fill behavior that is not ideal for truthful following feed.
3. Native For You does not call old feed routes in v2 mode; this is good and should be preserved.
4. Native Following still depends on old route family and can become early-exhausted under bounded windows.
5. Detail hydration is not blocking first paint for For You, but Following hydration is too broad and should be capped/deferred.

---

## Design (Phase 2)

## Goals

- Fast first paint with render-ready post cards.
- Strictly bounded Firestore work for startup and pagination.
- Preserve served/seen concept without large fan-out.
- No fake content.
- For You never empty when eligible real posts exist (allow recycled real posts as last resort).
- Following remains truthful to followed authors.

## For You Design: `fast-reel-first-v3`

- Keep endpoint: `GET /v2/feed/for-you`.
- Ranking: strong reel preference with occasional regular injection.
- Candidate windows:
  - first page hard cap total fetched docs <= 60
  - next page hard cap total fetched docs <= 80
- Query/read caps:
  - first page query target <= 6, read target <= 120
  - next page query target <= 8, read target <= 160
- Served filtering:
  - only for candidate ids fetched in current request
  - no broad served scans
- Selection:
  - unseen candidates first
  - then real recycled candidates if needed
  - never synth/fake
- Writes:
  - served writes only for returned posts
  - one batch commit
- Cursor:
  - stable structured `fy:v2` payload only
  - reject unknown versions gracefully
- Debug payload required:
  - rankingVersion, returnedCount, reelCount, regularCount, recycledCount, candidateDocsFetched, servedDocsChecked, servedDroppedCount, servedWriteCount, servedWriteOk, budgetCapped, emptyReason, cursorVersion, nextCursorPresent

## Following Design: production-safe bounded following

- Preferred endpoint shape:
  - startup + pagination through following-specific bounded behavior (can remain on current route surface short-term if contract is preserved, but logic must be isolated from explore offset behavior).
- Candidate sourcing:
  - load following ids from cached source first
  - fallback to bounded relation fetch with strict cap
  - no one-query-per-author explosion
- Query strategy:
  - bounded author chunks + recency order
  - optional fanout collection if present and cheap
  - strict read/query/fanout budgets
- Pagination:
  - stable cursor, avoid expensive offset scans
  - do not claim exhausted on partial bounded page when evidence suggests more
- Truthfulness:
  - no global-feed masquerade as following
  - if no followed content exists, return truthful empty reason
- Debug payload required:
  - returnedCount, followedAuthorCount, authorFanoutCount, queryCountEstimate, readEstimate, cursorVersion, emptyReason, budgetCapped

## Native Design Updates

- For You:
  - only call `/v2/feed/for-you` for startup + pagination
  - derive hasMore from `exhausted` and `nextCursor` safely
  - dev warn on legacy cursor (`cursor:`, `fc:v1:`)
  - dev warn when returnedCount is 0 while exhausted is false
- Following:
  - use bounded following route behavior for startup + pagination
  - do not set no-more from `count < limit` heuristics
  - dedupe guard scoped per tab
  - do not let For You served suppression affect Following
- Detail prefetch:
  - never block first paint
  - cap immediate prefetch to 1-2 posts
  - defer non-critical batch prefetch
  - cancel stale prefetch on generation reset

## Observability Design

- Add explicit summary events:
  - `feed_for_you_fast_summary`
  - `feed_following_fast_summary`
- Include:
  - requestId, viewerId, latencyMs, returnedCount, candidateDocsFetched, servedDocsChecked, servedDroppedCount, recycledCount, queryCountEstimate, readEstimate, budgetCapped, cursorVersion, nextCursorPresent, exhausted, emptyReason