# Achievements Read Slice Audit (Reconfirmation)

Date: 2026-04-20  
Scope: Reconfirm first safe v2 achievements slice before implementation.

## First-Render Fields Required

Native behavior confirms the hero payload is used as fastest meaningful render and must stay compact:

- `xp`: `current`, `level`, `levelProgress`, `tier`
- `streak`: `current`, `longest`, `lastQualifiedAt`
- `totalPosts`
- `globalRank` (nullable)

This route is user-visible and should avoid heavyweight arrays.

## Snapshot Fields Required

Native bootstrap logic expects snapshot-like data for authoritative reconciliation:

- `xp`, `streak`, `totalPosts`
- `challenges` (progress/counter state only; lean fields)
- `weeklyCaptures` + `weeklyCapturesWeekOf`
- `badges` (compact progress/claim metadata)
- `pendingLeaderboardEvent` (parity field for existing client handling, nullable)

Snapshot is read-first and should not include admin/debug-only metadata or event history replay.

## Pending-Delta Parity Behavior Required

Native currently polls for `pending-delta` and expects:

- nullable delta response (`null` when none)
- short-lived payload meant for immediate client reconciliation
- eventual consistency with authoritative snapshot

For v2 this remains bounded and read-only:

- no stream/list history
- single latest pending delta envelope per viewer
- explicit polling guidance in payload (`pollAfterMs`, `serverSuggestedBackoffMs`)

## Legacy Endpoints Still Relied On (Native)

Read-path relevant:

- `GET /api/achievements/hero/:userId`
- `GET /api/achievements/status/:userId`
- `GET /api/achievements/pending-delta`

Out of scope for this phase:

- claims (`claim-weekly-capture`, `claim-badge`, `claim-challenge`, `claim-intro-bonus`)
- leaderboard breadth (`/leaderboard/*`, `/leagues`)
- admin/debug achievement endpoints

## Pressure Risks (Current + Migration)

1. Broad bootstrap aggregation if hero/snapshot pull full leaderboard/admin detail.
2. Repeated pending-delta polling without collapse/backoff guidance.
3. Optimistic drift if pending deltas are treated as authoritative state.
4. Scope creep into claims/leaderboard writes in a read-only phase.

## What This Phase Intentionally Must NOT Include

- claim/mutation/admin/debug achievement routes
- full leaderboard families or ranking fan-out
- request-path historical event recomputation
- any broad cross-surface invalidation behavior

## Read Slice Decision

Implement only:

1. `GET /v2/achievements/hero`
2. `GET /v2/achievements/snapshot`
3. `GET /v2/achievements/pending-delta`

with strict route budgets, short cache TTLs, dedupe/concurrency caps, diagnostics visibility, and bounded fallback semantics.
