# Mixes pool read reduction (2026-07-08)

Fable 5 review: **APPROVE WITH AMENDMENTS**. All phases are Firestore read-only.

## Problem

July 7 Query Insights showed ~120,900 reads from `posts ORDER BY time DESC LIMIT 600` (~201 executions × 600 docs). Primary drivers:

1. `MixesRepository` background warmer — `setInterval` every 60s per Cloud Run instance
2. `MixPostsRepository.pageRecent` — re-fetched up to 600 docs per pagination page
3. Near-me exhaust loop — up to 24× `pageRecent` per request

## Phase 0 — deploy env (staging → prod)

```
MIXES_POOL_REFRESH_MS=300000
MIXES_POOL_MAX_DOCS=200
MIXES_POOL_COLD_START_DOCS=80
WARMER_FULL_BACKOFF_MS=600000
```

Rollback legacy timer: `ENABLE_MIXES_BACKGROUND_WARMER=true`

## Task 1 — lazy TTL snapshot (no background timer)

- Remove default `setInterval`; lazy refresh on access only
- Defaults: 80 cold start, 150 max pool, 5 min TTL, singleflight
- Stale serves do **not** trigger full 600-doc refreshes
- `ENABLE_MIXES_BACKGROUND_WARMER=true` restores legacy scheduled warmer

## Task 2 — true Firestore cursor pagination in `pageRecent`

- `orderBy("time","desc").orderBy(documentId(),"desc")` + `startAfter`
- Overfetch: `limit×3`, cap 120, max 3 chained queries
- Composite index required: `posts` — `time DESC`, `__name__ DESC` (verify in staging first)

## Task 3 — bootstrap + activity paths (revised)

- **Do not** route search bootstrap to `loadTopActivities` (220 reads/call)
- Keep bootstrap on in-memory `listFromPool()` snapshot
- Activity mixes: `pageByActivityAliases` with pool cap 72

## Task 4 — near-me exhaust caps

- Exhaust loop safety: 24 → 6 iterations
- Per-request Firestore read budget on exhaust path

## Success metrics (48h post-deploy)

- ≥90% drop in `LIMIT 600` Query Insights fingerprint
- `pool_refresh_completed` with `targetDocs=600` → zero
- Search bootstrap non-empty
- Mix pagination ≤ ~120 reads/page typical

## Deferred

- Redis shared pool (Phase 5) — try `min-instances: 1` first
