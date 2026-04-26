# Achievements Surface (v2 Read Slice)

Date: 2026-04-20  
Scope: first safe read-first slice only.

## Implemented Routes

- `GET /v2/achievements/hero`
- `GET /v2/achievements/snapshot`
- `GET /v2/achievements/pending-delta`

All routes are internal-gated and read-only.

## First-Render / Deferred Strategy

- `achievements.hero.get` is first-render oriented and intentionally compact.
- `achievements.snapshot.get` provides authoritative reconciliation state for challenges/captures/badges.
- `achievements.pendingdelta.get` is parity support for bounded polling, not an event stream.

No claim/mutation/admin/leaderboard breadth is included in this phase.

## Contract Summary

`hero`:

- XP summary, streak summary, totalPosts, optional global rank.

`snapshot`:

- XP, streak, totalPosts, challenge progress, weekly capture summaries, compact badge progress, nullable pending leaderboard event.

`pending-delta`:

- nullable single delta envelope with expiry metadata and poll guidance (`pollAfterMs`, `serverSuggestedBackoffMs`).

## Source-of-Truth Strategy

- Repository uses narrow state reads and pre-shaped records.
- Request path explicitly avoids full event-history recomputation, leaderboard fanout, and admin/debug payloads.
- Service layer applies in-flight dedupe and per-lane concurrency caps.

## Pressure Strategy

- Short route cache TTLs on hero/snapshot.
- Pending-delta no-data responses are briefly cached to collapse polling bursts.
- Route policies enforce strict latency/db/payload budgets.
- Diagnostics visibility is mandatory (`routeName`, `routePolicy`, `payloadBytes`, `dbOps`, `cache`, `dedupe`, `concurrency`, `fallbacks`, `timeouts`, `budgetViolations`).

## Route Policies

- `achievements.hero.get`: `critical_interactive`, cache required.
- `achievements.snapshot.get`: `deferred_interactive`, cache required.
- `achievements.pendingdelta.get`: `background`, cache recommended.

## Fallback + Staleness Semantics

- Current slice is read-safe and deterministic if source data is unavailable.
- Snapshot remains eventual-consistent relative to optimistic client state.
- Pending delta is consumptive and bounded; missing deltas reconcile via snapshot refresh.

## Intentionally Not Implemented

- claim routes (`claim-weekly-capture`, `claim-badge`, `claim-challenge`, `claim-intro-bonus`)
- leaderboard route families and league breadth
- admin/debug/test achievement endpoints
- server-side historical achievement replay in request path
