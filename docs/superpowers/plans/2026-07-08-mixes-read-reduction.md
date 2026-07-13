# Mixes pool read reduction (2026-07-08)

Fable 5 review: **APPROVE WITH AMENDMENTS**. All phases are Firestore read-only.

## Problem

July 7 Query Insights showed ~120,900 reads from `posts ORDER BY time DESC LIMIT 600` (~201 executions × 600 docs). Primary drivers:

1. `MixesRepository` background warmer — `setInterval` every 60s per Cloud Run instance
2. `MixPostsRepository.pageRecent` — re-fetched up to 600 docs per pagination page
3. Near-me exhaust loop — up to 24× `pageRecent` per request

## Phase 0 — deploy env (staging → prod)

`scripts/mainDeploy.sh` is the Backend v2 Cloud Run deploy entrypoint. It merges layered `.env` files
(`Locava Backend/.env`, `Locava-Native/.env`, `Locava-Backend-v2/.env`, `.env.local`) and ships env to
Cloud Run via `--env-vars-file`. Mixes read-reduction defaults are baked into the deploy script when unset:

```
MIXES_POOL_REFRESH_MS=300000
MIXES_POOL_MAX_DOCS=150
MIXES_POOL_COLD_START_DOCS=80
WARMER_FULL_BACKOFF_MS=600000
```

Override any value in `Locava-Backend-v2/.env` before `./scripts/mainDeploy.sh`.

Rollback legacy timer: `ENABLE_MIXES_BACKGROUND_WARMER=true`

## Index check (staging → prod, Fable A6)

`pageRecent` needs only a **single-field** index on `posts.time` (descending). Firestore rejects a `time` + `__name__` composite as unnecessary.

**Firebase web (no CLI):**

1. Firebase Console → project → **Firestore** → **Indexes** → **Single field** tab
2. Find collection **`posts`**, field **`time`**
3. Confirm it is **indexed** for Collection scope (Descending enabled, not listed under exemptions)

If a query still fails at runtime, Firestore logs include a **Create index** link — use that exact link (do not hand-build a composite unless the link asks for one).

## Recommended deploy order

1. Merge PR / checkout branch
2. Verify single-field index on `posts.time` in Firebase web (Indexes → Single field)
3. `./scripts/mainDeploy.sh` (env defaults ship automatically)
4. Smoke: search bootstrap, mix pagination page 2+, near-me exhaust
5. `./scripts/mainDeploy.sh` to production Cloud Run
6. Monitor Query Insights 48h


## Task 1 — lazy TTL snapshot (no background timer)

- Remove default `setInterval`; lazy refresh on access only
- Defaults: 80 cold start, 150 max pool, 5 min TTL, singleflight
- Stale serves do **not** trigger full 600-doc refreshes
- `ENABLE_MIXES_BACKGROUND_WARMER=true` restores legacy scheduled warmer

## Task 2 — true Firestore cursor pagination in `pageRecent`

- `orderBy("time","desc").orderBy(documentId(),"desc")` + `startAfter`
- Overfetch: `limit×3`, cap 120, max 3 chained queries
- Single-field index on `posts.time` (desc) — verify in Firebase web; composite `time` + `__name__` is not required

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
