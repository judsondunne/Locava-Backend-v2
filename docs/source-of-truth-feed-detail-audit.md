# Source-of-Truth Feed Detail Audit

Date: 2026-04-20  
Scope: `GET /v2/feed/items/:postId/detail` only.

## Current Path Audit

Audited files:

- `src/routes/v2/feed-item-detail.routes.ts`
- `src/orchestration/surfaces/feed-item-detail.orchestrator.ts`
- `src/services/surfaces/feed.service.ts`
- `src/repositories/surfaces/feed.repository.ts`
- `src/contracts/surfaces/feed-item-detail.contract.ts`

## 1) What Is Still Deterministic

In current feed detail path, all repository reads are deterministic:

- `getPostCardSummary`
- `getAuthorSummary`
- `getSocialSummary`
- `getViewerPostState`
- `getPostDetail`

`commentsPreview` is also deterministic and intentionally deferred.

## 2) Source-of-Truth Data Needed (Bounded)

For first-render contract fields, minimal real reads needed are:

- post record (selected post detail fields + counters + media metadata)
- author user record (handle/name/pic)
- viewer state projection (liked/saved) in a bounded manner

No neighboring posts, comments tree, or heavy media-plane work are needed.

## 3) Narrow Field Selection Requirements

Keep source reads narrow:

- `posts` query by bounded selector (`feedSlot` from routed post id), limit `1`
- selected post fields only:
  - `userId`, `caption`, `createdAtMs`, `updatedAtMs`
  - `mediaType`, `thumbUrl`, `assets`
  - `likeCount`, `commentCount`
- `users/{userId}` selected fields:
  - `handle`, `name`/`displayName`, `profilePic`/`profilePicture`/`photo`
- viewer state reads should be fixed-count and optional-fallback

## 4) Fan-Out Risk Locations

Fan-out risks in detail path:

- author lookup + social lookup + viewer-state lookup + detail lookup as separate uncoupled source calls
- duplicate same-post source reads from concurrent calls for the same detail open
- rebuilding author/social/viewer repeatedly despite shared entity cache paths

## 5) What Must Remain Deferred / Fallback-Backed

Remain deferred or fallback-backed:

- comments preview stays deferred with timeout/fallback behavior
- source unavailability or timeout must fail-open to deterministic path

## 6) What This Route Must NOT Start Loading

Must not add:

- neighboring feed item hydration
- comment tree hydration
- likes list/user lists
- media playback ladder recomputation
- map/directory or unrelated surface dependencies

## 7) Budget Risk Under Real Reads

Current route policy (`feed.itemdetail.get`) budget:

- reads <= 9
- queries <= 6
- payload <= 42KB

A bounded source bundle can fit within existing budgets if:

- source reads remain fixed-count
- duplicate per-request source reads are collapsed
- fallback is immediate on timeout

## Practical Conclusion

The remaining safe parity slice is to source-integrate the detail first-render bundle (post + author + social + viewer) using a bounded adapter and per-post request dedupe, while keeping contract shape, caches, deferred comments, and route budgets unchanged.

## Implemented In This Phase

Implemented adapter and repository integration:

- `FeedDetailFirestoreAdapter` with bounded source query strategy
- `FeedRepository` detail bundle source integration for:
  - `getPostDetail`
  - `getAuthorSummary` (detail-context)
  - `getSocialSummary`
  - `getViewerPostState`
- per-key in-flight detail bundle reuse to prevent duplicated source work for the same detail open

## Exact Source Query/Doc Strategy

For `:postId` -> slot parsed from `-feed-post-{slot}`:

1. Query `posts`:
   - `where("feedSlot", "==", slot)`
   - `orderBy("createdAtMs", "desc")`
   - `limit(1)`
   - selected fields only:
     - `userId`, `caption`, `createdAtMs`, `updatedAtMs`
     - `mediaType`, `thumbUrl`, `assets`
     - `likeCount`, `commentCount`
2. Read `users/{authorUserId}` for author summary fields.
3. Read `posts/{resolvedPostDocId}/likes/{viewerId}` for viewer liked.
4. Read `users/{viewerId}/savedPosts/{resolvedPostDocId}` for viewer saved.

All reads are fixed-count and bounded (no list fan-out).

## Fan-Out Prevention

- fixed-width source reads (one post candidate + three direct docs)
- no neighboring post fetch
- no comments tree/likes list expansion
- no extra media plane processing
- detail bundle in-flight sharing avoids repeated same-post source fetches across author/social/viewer/detail loaders

## Repeated Request Behavior

- route cache still collapses repeated identical detail requests
- observed repeated request: `dbOps.reads=0`, `dbOps.queries=0`
- entity cache still records shared summary/detail construction on cold path only

## Timeout/Fallback Discipline

- strict source timeout
- fail-open deterministic fallback remains active
- fallback and timeout markers are emitted in diagnostics:
  - `feed_detail_firestore_fallback`
  - `feed_detail_firestore`

## Budget Re-Validation

Route policy unchanged for `feed.itemdetail.get`:

- latency: p50 105ms / p95 230ms
- dbOps: reads<=9, queries<=6
- payload: target 24KB, max 42KB

Observed cold detail request remained within budget and diagnostics had no budget violations.
