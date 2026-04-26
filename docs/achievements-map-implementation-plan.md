# Achievements + Map/Directory Implementation Plan

Date: 2026-04-20  
Prerequisite: Part A stabilization fixes completed.

## Plan Goals

- Start only with low-pressure, read-first slices.
- Keep route -> orchestrator -> services -> repositories architecture.
- Preserve bounded invalidation and diagnostics discipline.
- Avoid reintroducing "sometimes instant, sometimes forever."

## Phase 1 (Recommended Next): Achievements Read Slice

Deliverables:

1. `GET /v2/achievements/hero`
2. `GET /v2/achievements/snapshot` (status + badges + weekly capture/challenge counters)
3. `GET /v2/achievements/pending-delta` parity path with explicit TTL + diagnostics markers

Non-goals in phase 1:

- claim endpoints
- leaderboard mutations/fanout writes
- admin/debug endpoints

Why first:

- Smaller payload and clearer ownership than map/directory.
- Lower geo/hydration pressure profile.
- Enables native integration foothold without broad mutation risk.

## Phase 2: Map Bootstrap Lean Slice

Deliverables:

1. `GET /v2/map/bootstrap` with marker-index-only payload:
   - `postId`, `lat`, `lng`, media hint/thumb, timestamp, activity IDs
2. strict cursor + limit bounds
3. route cache + dedupe + per-key concurrency limits

Non-goals in phase 2:

- weather overlays
- social batch enrichment
- full post hydration in bootstrap route
- contact/friend enrich blend in map bootstrap

## Phase 3: Directory Lean Slice

Deliverables:

1. `GET /v2/directory/users` paginated lean users
2. optional `q` search support
3. contract limited to identity card fields required for first render

Non-goals in phase 3:

- contacts phone matching/upload sync
- cohort users
- most-active-location community enrich

## Cross-Phase Safety Gates

For each route before promotion:

1. route policy budgets added and verified
2. diagnostics include routeName/routePolicy/dbOps/payload/cache/dedupe/concurrency/fallback-timeout
3. curl replay includes cold/warm paths
4. pressure replay includes parallel startup + overlap lanes
5. no broad invalidation added

## Pressure Controls Required

- hard per-route `limit` caps
- no unbounded scans
- dedupe keys normalized by viewer + query + cursor + limit
- bounded deferred work with timeouts and fallback markers
- explicit cache ownership and invalidation tags where mutations appear

## Open Risks To Track During Implementation

1. process-local coherence mode still active
2. external alert wiring for fallback/timeout signals still pending
3. pending-delta semantics need durable strategy before full production cutover

## Recommended Execution Order After This Phase

1. implement Achievements Phase 1 routes + tests + diagnostics verification
2. run staged load replay on achievements slice
3. implement Map Phase 2 bootstrap route
4. only then start Directory Phase 3

