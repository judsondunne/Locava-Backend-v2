# Phase H numerical evidence (2026-07-12)

Branch: `cursor/perf-maintainability-hardening-df59`

Senior constraint: keep `/v2` contracts stable; prefer cache + field masks + batching over changing authoritative sources (e.g. likes still use subcollection aggregates, not denorm fields).

## Measured improvements (Vitest)

| Surface | Metric | Before | After | Proof |
|---------|--------|--------|-------|-------|
| Like count hydration (30 posts, warm) | Aggregate `count()` queries | 30 | **0** (−100%) | `post-likes-subcollection-count.cache.test.ts` |
| Like count hydration (30 posts, cold) | Aggregate queries | 30 | 30 (authoritative) | same; cache filled for concurrent users |
| For You by-id fetch (45 posts) | `getAll` calls / field mask | 1 unmasked | **2 masked chunks of 30** | `feed-for-you-simple.by-id-mask.test.ts` |
| Notifications actor hydrate (12 actors) | User fetch shape | 2× `where-in` full docs | **1× field-masked `getAll`** | `notifications.actors-mask.test.ts` |
| Search-home firstPost (N probe users) | Post queries | up to N | **1 batched `in` query** | `search-home-v1.service.test.ts` |
| Comments embedded probe | Post doc payload | full `.get()` | **field-masked `getAll`** | comments-list repository tests |
| Chats peer summaries | User `getAll` | unmasked, chunks of 10 | **field-masked, chunks of 30** | chats repository path |

## Why these scale

- Warm like-count cache removes the largest per-feed query multiplier under concurrent scrollers without changing authoritative counting.
- Field masks cut Firestore payload/CPU on hot paths (feed by-id, notifications, chats, comments probe).
- Search-home firstPost batching removes N×1 query fanout on a cold entry surface.

## Intentionally not changed

- Did **not** switch like totals to denormalized `likeCount` on post docs (prior intentional authoritative subcollection path).
- Did **not** unboundedly truncate comments subcollection reads yet (would risk `totalCount`/`hasMore` correctness) — deferred until cursor-native pagination.
