# Final Coherence Validation (Backendv2)

Date: 2026-04-20  
Scope: Redis and multi-instance coherence behavior under practical local simulation.

## Validation Setup

- Redis launched locally on `127.0.0.1:6380`.
- Two Backendv2 instances started:
  - instance A: `PORT=18083 COHERENCE_MODE=redis REDIS_URL=redis://127.0.0.1:6380`
  - instance B: `PORT=18084 COHERENCE_MODE=redis REDIS_URL=redis://127.0.0.1:6380`
- Evidence captured in:
  - `docs/evidence/final-ready-redis-a.json`
  - `docs/evidence/final-ready-redis-b.json`
  - `docs/evidence/final-diagnostics-redis-a.json`
  - `docs/evidence/final-diagnostics-redis-b.json`

## Coherence Mode Verification

- `/ready` on both instances reports:
  - `mode: redis`
  - `processLocalOnly: false`
  - `redisConfigured: true`
  - `warning: null`
- This confirms Redis coherence mode is actually active (not process-local fallback).

## Practical Multi-Instance Checks

### 1) Duplicate same-key read pressure across instances

Flow:
- warm `GET /v2/feed/page?limit=10` on instance A
- execute repeated same-key calls on A and B in parallel

Observed:
- no budget violations
- no fallback/timeouts
- stable low p95s on both instances (`~0.53ms` A, `~1.14ms` B in sample)

Interpretation:
- shared-coordinator path is functioning for same-key read churn without instability.

### 2) Cross-instance mutation lock/idempotency behavior

Flow:
- call `POST /v2/posts/:postId/like` with same `clientMutationKey` from A then B.

Observed:
- no mutation-lock timeout
- no error spikes
- no budget violations in either instance sample

Interpretation:
- distributed lease/idempotency path behaves safely under practical duplicate mutation attempts.

### 3) Invalidation behavior across instances

Flow:
- warm `GET /v2/collections/saved` on A and B
- run `POST /v2/posts/:postId/save` on A
- re-read `GET /v2/collections/saved` on B

Observed:
- B read remains healthy and reflects post-mutation state path without instability
- no fallback/timeout/budget alerts in redis-mode diagnostics

Interpretation:
- route-cache invalidation behavior is coherent enough for cross-instance practical flow tested here.

## Limits of Simulation

- This is a two-instance local simulation, not full production topology.
- It does not model:
  - network partitions
  - Redis failover
  - very high pod count lease contention
  - cross-region latency
- Therefore, confidence is operationally meaningful but not an exhaustive distributed-systems proof.

## Final Coherence Assessment

- Redis coherence materially closes the multi-instance gap versus process-local mode.
- No blocking coherence regression observed in this validation pass.
- Remaining risk is operational: Redis reliability/monitoring/SLO enforcement, not obvious code-path breakage in current implementation.
