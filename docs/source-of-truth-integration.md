# Source-of-Truth Integration (v2)

## Integrated Slice (This Phase)

Real source-of-truth integration is enabled for:

- `GET /v2/search/users`
- `GET /v2/search/results` (candidate retrieval layer only)
- `GET /v2/feed/bootstrap` (candidate retrieval layer only)
- `GET /v2/feed/page` (candidate retrieval layer only)
- `GET /v2/feed/items/:postId/detail` (bounded detail bundle path)

using:

- `SearchUsersFirestoreAdapter`
- optional Firestore client bootstrap (`firebase-admin`)
- deterministic fallback when Firestore is unavailable

## What Is Real vs Mock-Backed

Now real-data backed (when Firestore credentials/runtime are available):

- `search.users.get` repository primary query path
- `search.users.get` viewer follow projection read path
- `search.results.get` candidate retrieval query path (post IDs + rank metadata)
- `profile.bootstrap.get` header/relationship/bounded preview retrieval path
- `profile.postdetail.get` selected post detail retrieval path

Still mock-backed:

- profile grid continuation pagination route
- auth/bootstrap seed repositories

## Read-Safety Strategy

`search.users` read path intentionally bounds work:

- max 2 prefix queries (`searchHandle`, `searchName`)
- max 1 batched follow-state lookup (`getAll` on following docs)
- strict `limit` bounds (5..12)
- bounded scan cap per query
- selected fields only (no heavy user docs)

## Fan-Out Avoidance

Intentionally does **not** load:

- user posts
- profile detail sections
- social graph blobs
- any per-result heavy enrichment

## Cache + Dedupe Strategy

- route cache for identical query pages
- in-flight dedupe for same `(viewer, query, cursor, limit)`
- concurrency cap on repository lane
- `AuthorSummary` entity cache reuse (`user:{userId}:summary`)

## Mutation Coherence

Viewer follow state in search users reflects:

- source-of-truth follow docs when available
- plus in-memory mutation shadow state for write-read coherence during transition

This preserves follow/unfollow consistency expectations while migration is in progress.

## Budget Re-Validation Notes

`search.users.get` policy remains:

- latency: `p50 85ms`, `p95 200ms`
- dbOps: `maxReadsCold 24`, `maxQueriesCold 3`
- payload: `target 10KB`, `max 20KB`

No policy relaxations were introduced in this phase.

## Tradeoffs

- Requires indexed lowercased fields (`searchHandle`, `searchName`) for best performance
- Firestore-unavailable path falls back to deterministic corpus by design for reliability
- cursor remains offset-based for this narrow surface in current phase

## Next Recommended Slice

Next safest integration target:

- feed detail source retrieval path (`feed.itemdetail.get`) with strict timeout fallback and no contract changes.

## Feed Source Strategy

`feed.bootstrap` and `feed.page` now use:

- `FeedFirestoreAdapter` candidate query on `posts` ordered by `createdAtMs desc`
- minimal selected fields (`feedSlot`, `createdAtMs`, `updatedAtMs`)
- bounded scan cap + offset cursor slicing
- strict timeout + deterministic fallback markers:
  - `feed_candidates_firestore_fallback`
  - `feed_page_firestore_fallback`

Candidate retrieval is source-backed when available; shared card shaping remains on existing feed shared-entity/cache path (unchanged contract).

`feed.itemdetail` now uses:

- bounded source post selection by `feedSlot` (parsed from routed post id)
- selected post fields only (detail + media + social counters)
- one author doc read + two bounded viewer-state doc reads
- per-post detail bundle in-flight reuse to avoid duplicate source reads across author/social/viewer/detail loaders
- strict timeout + deterministic fallback with diagnostics markers

Contract shape remains unchanged and deferred comments preview remains separate.

## Search Results Source Strategy

`search.results` now uses:

- Firestore adapter query on `posts.searchText` prefix range
- minimal selection (`feedSlot`, `searchRank`, `updatedAtMs`)
- bounded scan cap + cursor slicing
- strict timeout + deterministic fallback

Candidate retrieval is real-data backed; shared post-card shaping still flows through existing `FeedService` shared entity/cache path (unchanged contract).

## Profile Source Strategy

`profile.bootstrap` now uses source-of-truth reads for:

- `users/{userId}` header/counts
- relationship docs under `users/{viewerId}/following` and reverse following check
- bounded preview query on `posts` by `userId` ordered by `createdAtMs`

`profile.postdetail` now uses source-of-truth reads for:

- selected `posts/{postId}` doc (with ownership validation)
- `users/{userId}` author summary fields

Both paths use strict timeout fallback to deterministic repository behavior and preserve existing route contract, cache, dedupe, and diagnostics semantics.

## Achievements Read Slice Strategy

The first achievements migration slice is deliberately read-first and bounded:

- `GET /v2/achievements/hero`
- `GET /v2/achievements/snapshot`
- `GET /v2/achievements/pending-delta`

Source strategy:

- narrow, pre-shaped state reads only (no route-path event history rebuild)
- no leaderboard fanout reads in this phase
- no claim/admin/debug mutation paths in this phase

Pressure controls:

- route-level cache on hero/snapshot
- short no-delta response cache window on pending-delta to reduce polling churn
- in-flight dedupe and repository concurrency caps
- strict route-policy budgets with diagnostics enforcement

## Map Bootstrap Lean Strategy

The first map migration slice is intentionally marker-index only:

- `GET /v2/map/bootstrap?bbox=...&limit=...`

Source strategy:

- bounded index query against pre-shaped marker summaries
- strict bbox validation
- hard limit bounds
- no list/detail mixed hydration in request path

Pressure controls:

- route cache for repeated identical bounds/limit requests
- in-flight dedupe keyed by bbox + limit
- repository concurrency capping
- strict route-policy budget enforcement and diagnostics visibility

Explicitly excluded in this phase:

- marker detail/post detail hydration
- social/comment enrichment
- weather overlays
- contact/directory blending

## Directory Lean Users/Search Strategy

The first directory migration slice is intentionally users-only and pressure-bounded:

- `GET /v2/directory/users`

Source strategy:

- reuses bounded source adapter behavior from `search.users` for prefix-searchable user summaries
- selected fields only (`userId`, `handle`, `name`, `pic`)
- strict cursor paging + hard `limit` bounds (`5..12`)
- no contacts/cohort/location enrich lanes in this phase

Pressure controls:

- route cache on `(viewer, query, cursor, limit)`
- in-flight dedupe keyed to the same dimensions
- repository concurrency cap (`max 4`)
- shared `AuthorSummary` entity cache reuse (`user:{userId}:summary`)
- strict route-policy budget enforcement and diagnostics visibility

Explicitly excluded in this phase:

- contact ingestion/matching/address-book upload
- graph/cohort/location suggestion breadth
- posts/collections/chat/map hydration in directory rows
- any unbounded `/users/all` style list pull parity
