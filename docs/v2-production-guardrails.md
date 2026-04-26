# V2 Production Guardrails

## Why this exists

This backend is hardened to prevent request storms, payload bloat, and optional work from degrading interactive routes.

## Guardrails now enforced

### 1) Route policy framework

Each critical v2 route has policy metadata in `src/observability/route-policies.ts`:

- route priority (`critical_interactive`, `deferred_interactive`, `background`, `internal_debug`)
- latency budgets (p50/p95)
- db operation budgets (reads/queries)
- payload budget (target/max bytes)
- cache expectation
- concurrency expectation

### 2) Runtime budget visibility

On every request completion, diagnostics/logs now include:

- `routePolicy`
- `payloadBytes`
- `budgetViolations` (`latency_p95_exceeded`, `db_reads_exceeded`, `db_queries_exceeded`, `payload_bytes_exceeded`)

### 3) Payload size tracking

`onSend` hook records approximate response bytes into request context. This is surfaced in diagnostics and logs.

### 4) Dedupe instrumentation

`dedupeInFlight` records request-scoped `dedupe.hits` and `dedupe.misses` metrics.

### 5) Concurrency limit helper

`src/lib/concurrency-limit.ts` provides per-key concurrency capping with request-scoped `concurrency.waits` tracking.

Applied to:

- auth/session/bootstrap repository calls
- profile grid pagination repository call
- profile post-detail + comments preview repository calls

### 6) Timeout/fallback discipline

Deferred/optional stages are timeout-bounded and fail-open in orchestrators with explicit fallback/timeout metadata.

## Required route implementation pattern

For every new v2 route:

1. Add route policy in `src/observability/route-policies.ts`
2. Set route name in route handler via `setRouteName(...)`
3. Keep first-render/deferred/background separation in orchestrator
4. Apply timeout+fallback for optional/deferred work
5. Use `dedupeInFlight` for same-key repeated work
6. Use `withConcurrencyLimit` around expensive repo/service calls
7. Validate diagnostics for budget visibility and payload bytes

## Diagnostics checklist

Use `/diagnostics?limit=20` and verify route entries include:

- `routeName`
- `routePolicy.priority`
- `payloadBytes`
- `dbOps`
- `cache`
- `dedupe`
- `concurrency`
- `fallbacks` / `timeouts`
- `budgetViolations`
