# Radius feed pagination + feed-switch reset — audit (2026-05-03)

## Root causes

### Native (primary blocker)

`ReelsFeedHeavy` always fed `shouldPrefetchForYouNextPage` with **For You’s** `nextCursor` from `reelsBootstrap`, even in **near-me mode** (`useNearMeBootstrap`).

The gate dedupes on `prefetchedCursor === paginationCursor`. After the **first** near-me prefetch, `prefetchedForCursorRef` stayed pinned to the For You cursor while **`fetchNextPage` correctly called the near-me query**. Subsequent checks saw `prefetchedCursor === wrongForYouCursor` forever, so **`fetchNextPage` never ran again** (~2 pages ≈10 posts), leaving the loading tail spinning while the backend kept returning valid `hasMore` + `nrm` cursors.

### Backend (correctness ceiling)

`/api/v1/product/reels/near-me` only paginated posts present in the **in-memory warm pool** (quick ~450 docs, optional full warmer). Candidate ordering was **time-desc**, not radius-centric distance order, and **there was no continuation past the filtered pool**. Any posts inside the radius but **older than the newest N global posts were invisible** regardless of native behavior.

### Native (UX)

Scroll restore used **global home offset** keyed only by viewport height with no stable **feed identity** reset when toggling global For You vs radius, so visible index/snap could briefly follow “old” scroll math and feel like “post index carried over”. `requestHomeScrollToTop('radiusChanged')` was not enough alone when identity changed without navigating that path reliably.

---

## Backend fix (`legacy-reels-near-me.routes.ts`)

1. **Pool candidates** filtered as before but sorted **`distance ascending`**, tie-break **`postId`** (deterministic nearest-first ordering for the warm pool slice).
2. **Two-phase pagination cursor (`nrm:v2`)**  
   - `mode: pool` — offset into the filtered warm pool + `seen` ring buffer (`seen` IDs for dedupe).  
   - `mode: exhaust` — Firestore exhaustive path after the pool slice is exhausted (or immediate jump when the pool yields zero radius hits):
     - Shared **geohash prefix scans** aligned with mixes’ `geoPrefixesAroundCenter` (factored into `src/lib/geo-prefixes-around-center.ts`; `searchMixes.service.ts` reuses it).
     - Bounded **`MixPostsRepository.pageRecent`** sweep (same fallback family as mixes “near_you”) filtered by eligibility + Haversine.
3. **Diagnostics** appended to `[RADIUS_FEED_PAGE]` logs: `scanMode`, pool offset/exhaust flags, Firestore fallback usage, duplicate suppression counters, candidate sources list, cursor invalid-recovery hints, explicit `nearMeMode`.
4. **Response**: `radiusFeedDebug` mirrors `debug` when `debug=1` query param present; **`hasMore` + `nextCursor` must stay coherent** (`hasMore` false forces no cursor; `hasMore` true without cursor clears `hasMore` with `radius_invalid_has_more_no_cursor`).
5. **Tests**: Cursor round-trip expanded for `pool`/`exhaust` modes (`legacy-reels-near-me.cursor.test.ts`).

**Note:** Exhaustive scans are bounded per request (`safety` loop + caps in repositories) to avoid runaway latency; correctness target is **no premature “feed end” purely because the warm pool ended**.

---

## Native fix (`ReelsFeedHeavy.tsx`, hooks, API)

1. **`paginationCursor` derived only from `data.pages[last].nextCursor`** of the active infinite query — never From You’s bridged cursor in radius mode.
2. **Feed identity** key `near:{radius}:{lat}:{lng}` vs `foryou:…` resets prefetch refs, `activeIndex`, scroll offset persistence, commits `FlatList.scrollToOffset(0)`, and **`key=` remount** for the reels list when identity changes.
3. **`useNearMeBootstrap`**: stable monotonic-ish `feedSessionId` per `{lat,lng,radius}` rounding key; **`getNextPageParam` gated on `hasMore === true`** and non-empty cursor; logs: `[RADIUS_FEED_NATIVE_*]` / `[RADIUS_FEED_NATIVE_LOADING_CLEARED]`.
4. **`fetchNearMeReelsPage`** logs consolidated response diagnostics with `feedSessionId`.
5. **`ReelsBootstrapResponse.hasMore?: boolean`** typed for parity with backend payloads.

Shared **change-location** flow still relies on **`fetchNearMeCount`** (pool-only approximation). Count vs exhaust feed may diverge intentionally; exhaustive feed is the authoritative scroll path.

---

## Tests / harnesses run

| Check | Status |
|--------|--------|
| `npm run typecheck` (Backendv2) | ✅ pass |
| `vitest run src/routes/compat/legacy-reels-near-me.cursor.test.ts` | ✅ pass (mode pool + exhaust snapshot) |
| Seeded emulator test (30 posts, page until exhaustion) | **Not run** in CI — requires Firebase emulator dataset + scripted HTTP loop (existing manual script `scripts/debug-radius-near-me-pagination.mts`). |

Native Jest/unit coverage for reels gates was **not extended** here (would require RN test harness mocking React Query streams).

---

## Manual verification checklist

1. For You → scroll ~3 posts.
2. Open menu → **10 miles** → confirm **`[FEED_IDENTITY_CHANGED_RESET_TO_TOP]`** + list starts visually at reel 1.
3. Scroll down past ~15–20 reels — confirm **`[RADIUS_FEED_NATIVE_REQUEST]`** shows progressing `cursorPresent: true` and cursor prefix `nrm:v2`.
4. Confirm **no indefinite loading tail**: when server returns `hasMore: false`, end card renders.
5. Backend logs **`[RADIUS_FEED_PAGE]`** show `nearMeMode: exhaust` once pool depleted; `scanMode` reflects `pool` / `pool_plus_exhaust` / `exhaust`.
6. Switch back to **Clear location** → For You still paginates.

---

## Residual risks

- **Throughput / cost**: Exhaustive scans add Firestore reads on deep pagination; guarded by loops + Mix/Nearby repository caps — monitor latency.
- **Distance ordering**: Global ordering across heterogeneous Firestore batches is **best-effort** (per-batch nearest sort + deterministic scan order); not a single fused global KD-tree.
- **Geohash field parity**: Prefix queries require top-level `geohash`; posts missing it rely on **`pageRecent`** path.
- **Count endpoint**: Still pool-only approximation — could under-count vs exhaustive feed.

---

## Files touched (high-level)

**Backend**: `legacy-reels-near-me.routes.ts`, `geo-prefixes-around-center.ts` (new), `searchMixes.service.ts`, `legacy-reels-near-me.cursor.test.ts`  
**Native**: `ReelsFeedHeavy.tsx`, `useNearMeBootstrap.ts`, `nearMeRadius.api.ts`, `reels.types.ts`
