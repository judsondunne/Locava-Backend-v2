# Search Home v1 — Firestore query shapes

## Posts by activity (mix preview + mix page)

- **Query:** `posts` where `activities` **array-contains** `{activityKey}` with a bounded `.limit(...)`.
- **Ordering:** No composite `orderBy` on `(activities, time)` in v2 code; posts are sorted by `time` desc **in memory** after fetch (see `MixPostsRepository.pageByActivity`).
- **Index:** Single-field index on `activities` is typically auto-created by Firestore for `array-contains`.

## Posts by author (suggested user first post)

- **Query:** `posts` where `userId` **==** `{userId}` with bounded `.limit(...)` (no `orderBy` in-query).
- **Ordering:** Sorted by `time` desc in memory (`MixPostsRepository.listRecentPostsByUserId`).
- **Index:** Single-field equality on `userId` is auto-indexed.

## TODO: composite indexes

If Firestore rejects a query or performance requires it, add a composite index (document here with console link):

- `activities` array-contains + `time` desc (+ `__name__` desc) — **only if** we switch to server-ordered activity queries.

Do **not** add full-collection scans as a fallback.
