# Backend Bog-Down Risk Audit (Final)

Date: 2026-04-20  
Scope: Final explicit audit of whether any route/flow can still create backend pressure severe enough to degrade app/media-perceived performance.

## Core Question

Can Backendv2 still generate "too many calls at once" pressure that cascades into server load, Firestore load, and indirect client/media slowdown?

## Evidence Inputs

- Full route/flow audit (`docs/final-backend-route-audit.md`)
- Combined-flow run diagnostics (`docs/evidence/final-diagnostics-process-local.json`)
- Soak cycles (`docs/evidence/final-soak-metrics.ndjson`, 5 repeated cycles)
- Strict-mode diagnostics (`docs/evidence/final-diagnostics-strict.json`)
- Redis coherence validation (`docs/final-coherence-validation.md`)

## High-Pressure Scenarios and Residual Risk

### 1) Startup fan-in storm

Routes:
- `auth/session`, `bootstrap`, `feed/bootstrap`, `notifications`, `chats/inbox`, `achievements/*`, `map/bootstrap`

Current control:
- route cache + dedupe + lane caps + request budgets

Residual risk:
- **Medium in process-local mode** under multi-instance cold bursts (non-shared warm state)
- **Lower in redis mode** based on this validation run

### 2) Feed interaction burst and invalidation churn

Routes:
- `feed/page`, `feed/detail`, `like/save/comment`, `collections/saved`, `notifications`

Current control:
- idempotent mutations + targeted invalidation + entity cache reuse

Residual risk:
- **Medium** for bursty mutation/read overlap; still bounded but can recache hot first pages repeatedly.

### 3) Posting poll storm risk

Routes:
- `posting/media/:mediaId/status`, `posting/operations/:operationId`

Current control:
- lock/idempotency and bounded status paths

Residual risk:
- **Medium-high** if clients poll too aggressively (no strict server-side poll-rate clamp).

### 4) Search/directory query churn

Routes:
- `search/results`, `search/users`, `directory/users`

Current control:
- per-key dedupe + cache + budget constraints

Residual risk:
- **Medium-high** for high unique-query churn where keys differ rapidly (dedupe only helps exact-key overlap).

### 5) Chat burst overlap

Routes:
- `chats/inbox`, `chats/thread`, `chats/send`, `chats/mark-read`

Current control:
- lock/idempotency + targeted invalidation

Residual risk:
- **Medium** under sustained high-frequency send/read cycles; coherent in tested burst window.

## Firestore Read / Fan-Out / Churn Risk Assessment

- Firestore read amplification is bounded in current adapters/repositories, but source-backed strict routes can still impose concentrated read pressure during overlap windows.
- No evidence of unbounded fan-out loops in route logic.
- Risk is **burst concurrency + key diversity**, not runaway recursive fan-out.

## Invalidation Burst Risk

- Invalidation remains targeted (not full-cache wipe), which avoids catastrophic cache storms.
- Risk remains in high mutation cadence causing repetitive first-page recache pressure.

## Polling-Storm Risk

- Poll-heavy routes are the most likely to create avoidable backend pressure without strict poll discipline.
- This remains one of the top cutover-sensitive risks.

## Soak Findings

From 5 repeated combined-flow cycles:
- fallbackRate stayed `0`
- timeoutRate stayed `0`
- budgetViolationRate stayed `0`
- p95 latency stayed stable (`0.30-0.38ms` sample window)

Interpretation:
- no observed degradation drift, cache pollution drift, or rising-latency instability in repeated local cycles.

## Final Bog-Down Verdict

- **No single route currently shows a severe unbounded bog-down path in this final validation.**
- **Remaining meaningful bog-down risk is combined-flow pressure under production-like scale**, primarily:
  1. process-local mode startup overlap (if redis not enabled)
  2. aggressive posting polling
  3. high unique-query search churn

These are operationally manageable but must be monitored tightly during staged cutover.
