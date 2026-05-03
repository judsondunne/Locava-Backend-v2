# Radius Feed Pagination Audit (2026-05-03)

## Root Cause

The radius feed endpoint (`/api/v1/product/reels/near-me`) used a legacy offset-only cursor (`cursor:<n>`) against a periodically refreshed in-memory candidate pool.

When the pool refreshed between page requests, the old offset could become invalid for the new candidate ordering/size. In those cases the route could return an empty page and no `nextCursor`, which caused client pagination to stop even though eligible posts could still exist.

## Why Pagination Stopped

- Cursor only tracked `offset`, with no radius/location/pool compatibility context.
- Cursor resume did not attempt recovery when data shifted between requests.
- End-of-feed state was inferred from one offset slice against a mutable pool.
- The response did not expose strong pagination diagnostics to explain stop conditions.

## Files Changed

- `src/routes/compat/legacy-reels-near-me.routes.ts`
- `src/routes/compat/legacy-reels-near-me.cursor.test.ts`
- `scripts/debug-radius-near-me-pagination.mts`
- `Locava-Native/src/features/home/nearMe/nearMeRadius.api.ts`
- `Locava-Native/src/features/home/hooks/useNearMeBootstrap.ts`

## Fix Summary

### Backend cursor hardening

- Added versioned radius cursor: `nrm:v2:<base64url-json>`.
- Cursor now carries:
  - `offset`
  - `radiusMiles`
  - rounded location (`latE5`, `lngE5`)
  - `lastPostId`
  - `poolLoadedAtMs`
- Backward compatibility retained for legacy `cursor:<n>` cursors.

### Cursor compatibility and recovery

- Reject malformed v2 cursors with HTTP `400`.
- Reset pagination safely when radius/location are incompatible.
- On pool refresh, recover continuation by locating `lastPostId`.
- If offset is out-of-range after refresh, recover to a safe tail window instead of hard-stopping.

### Response contract improvements (backward compatible)

- Added `hasMore` to `/near-me` responses.
- Added debug diagnostics object with cursor state, reset reason, pool version, and page stats.
- Added structured server logs with `[RADIUS_FEED_PAGE]` prefix.

### Native diagnostics

- Added `[RADIUS_FEED_CLIENT]` request/response logs for near-me page fetches.
- Added `[RADIUS_FEED_CURSOR]` before/after cursor logs.
- Added near-me infinite query next-cursor evaluation logs.

## Tests Added

- `legacy-reels-near-me.cursor.test.ts`
  - legacy cursor parsing
  - v2 cursor round-trip
  - reset on radius mismatch
  - recovery by `lastPostId` when pool refreshes

## Manual Verification Harness

- Added `scripts/debug-radius-near-me-pagination.mts`:
  - fetches first page + subsequent pages up to `MAX_PAGES`
  - checks duplicate post IDs across pages
  - logs page size, `nextCursor`, `hasMore`, distance range, and debug diagnostics

## Remaining Risks

- Route still depends on bounded in-memory pool quality/freshness; this patch prevents cursor invalidation stalls but does not redesign pool sourcing.
- Ordering remains existing behavior (current product behavior preserved), so this is a reliability hardening pass rather than a ranking model rewrite.
