# Achievements Discovery (Native + Legacy Audit)

Date: 2026-04-20  
Scope: Discovery only (no route implementation in this phase).

## What Exists Today

Primary native surface files:

- `Locava-Native/src/features/achievements/Achievements.entry.tsx`
- `Locava-Native/src/features/achievements/Achievements.content.tsx`
- `Locava-Native/src/features/achievements/achievements.store.ts`
- `Locava-Native/src/features/achievements/data/achievements.api.ts`

Legacy backend controller coverage:

- `Locava Backend/src/controllers/achievements.controller.ts`
- `Locava Backend/src/controllers/achievementsAdmin.controller.ts`
- `Locava Backend/src/services/pendingDeltaStore.ts`

## Current API Surface Used by Native

Read/bootstrap style:

- `GET /api/achievements/hero/:userId`
- `GET /api/achievements/status/:userId`
- `GET /api/achievements/badges/:userId`
- `GET /api/achievements/pending-delta`
- `GET /api/achievements/leaderboard/:type/:userId`
- `GET /api/achievements/leagues`

Mutations/commands:

- `POST /api/achievements/screen-opened`
- `POST /api/achievements/ack-leaderboard-event`
- `POST /api/achievements/claim-weekly-capture`
- `POST /api/achievements/claim-badge`
- `POST /api/achievements/claim-challenge`
- `POST /api/achievements/claim-intro-bonus`
- debug/test calls (`regenerate-weekly-captures`, `evaluate-badges`, etc.)

## Render + Data Behavior

- First visible stage is cache-first from MMKV, then async refresh.
- The store runs parallel hero/status/badges bootstrap and deferred leaderboard refresh.
- Multiple retry/backoff timers exist for bootstrap, hero, badges hydration, and rank-audit flows.
- Pending delta is explicitly poll-based and backed by process memory in legacy (`pendingDeltaStore`), not durable.

## Required Counters/Aggregates

From native behavior and store logic:

- XP total/level/tier/progress.
- Streak and total posts.
- Weekly captures + completion state.
- Challenges counters by source (`action_count`, `following_count`, `total_posts`, etc.).
- Badge progress/claim state.
- Leaderboard ranks across scopes (`xp_global`, `xp_league`, `xp_friends`, `city`, etc.).
- Pending leaderboard events + acknowledgement.

## How Progress Is Driven

Mixed model:

- Event-driven updates (follow, post create, comment-like actions).
- Computed snapshots on bootstrap refresh.
- Client-applied optimistic delta/reconcile loops.
- Poll-based pending delta delivery.

Not a single pure precomputed path; it is hybrid and stateful.

## Pressure/Risk Areas

1. Bootstrap fanout (hero + status + badges + leaderboard lanes).
2. Retry timers causing repeated overlap after failures.
3. Pending-delta poll dependence and process-local legacy store semantics.
4. Leaderboard multi-scope refresh and modal/rank reconciliation churn.
5. Debug/admin achievement endpoints mixed into same backend family (operational surface breadth).

## Smallest Safe v2 Slice

Recommended first v2 slice (read-first, low-risk):

1. `achievements.hero.get` (top-card only)
2. `achievements.snapshot.get` (status + badges + weekly capture/challenge counters; no leaderboard writes)
3. `achievements.pending-delta.get` parity path with explicit TTL and diagnostics

Defer in initial slice:

- claim endpoints
- leaderboard fanout lanes
- admin/debug achievement endpoints
- challenge/badge evaluation mutation logic

## Dependencies and Event Inputs To Plan For

- Post creation/finalization events
- Follow/unfollow events
- Comment/like events (if challenge counters depend on them)
- Save/collection events (if challenge counters depend on them)
- Viewer auth/session context
- Durable idempotency and replay-safe award application

