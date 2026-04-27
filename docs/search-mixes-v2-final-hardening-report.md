## Search mixes v2 — final hardening report

### Summary
- **Goal**: production-grade, Spotify-style discovery shelves (nearby + activity + daily + friends) with stable pagination, geo relevance, and compatibility for legacy/native call sites.
- **Status**: implemented the hardening plan items for backend mixes + compat routes + native caching; all added tests are passing under deterministic suite.

### Key backend fixes
- **Compat endpoints (native 404s)**:
  - `POST /api/posts/batch` now exists and returns lightweight hydrated post cards.
  - `GET /api/users/:userId/full?compact=1` now exists and returns minimal `userData` with caching.
- **Story-users latency**:
  - `POST /api/v1/product/connections/user/:viewerId/story-users` now uses in-memory caches for following ids and recent posts to avoid repeated wide scans.
- **Pagination + cutoffs**
  - Mix pool caps were lifted (pool generation + ranking no longer truncates to a single page), enabling multi-page scrolling without early cutoff.
  - Added pagination regression tests for `activity:hiking`.
- **Distance-first ranking**
  - Generic activity mixes are now **distance-primary** (closest-first with score tie-breaks).
  - Added debug scoring fields in `includeDebug` and a distance-order test.
- **Daily + Friends**
  - Daily mix now uses viewer activity profile when available, otherwise falls back to nearby posts.
  - Friends mix candidates are tagged with `authorSource` for explainability.

### Tests added
- Mix pagination: `src/routes/v2/search-mixes.pagination.test.ts`
- Distance-first ranking: `src/routes/v2/search-mixes.distance-ranking.test.ts`
- Daily: `src/routes/v2/search-mixes.daily.test.ts`
- Friends: `src/routes/v2/search-mixes.friends.test.ts`
- Compat: `src/routes/compat/legacy-api-stubs.posts-batch.test.ts`, `src/routes/compat/legacy-api-stubs.user-full.test.ts`, `src/routes/compat/legacy-api-stubs.story-users.test.ts`

### Useful commands
- `npm run audit:mixes:pagination`
- `npm run audit:mixes:distance`
- `npm run audit:mixes:daily`
- `npm run audit:mixes:friends`

