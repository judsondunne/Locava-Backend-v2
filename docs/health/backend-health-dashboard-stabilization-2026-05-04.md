# Backend Health Dashboard Stabilization - 2026-05-04

## What Was Broken

- Health auditing was ad-hoc; there was no deterministic CLI guardrail that validates health JSON shape and fails on hard conditions.
- Route registry drift checks were missing for duplicate route names and method/path collisions with different route names.
- Dashboard route status logic overreacted for low sample sizes and did not expose route sample-size confidence.
- Dashboard error feed did not provide grouped top error signatures for fast triage.

## What Was Fixed

- Added `npm run health:audit` via `scripts/health-audit.mts`.
  - Supports `HEALTH_AUDIT_MODE=inject` for deterministic local checks without bootstrapping a separate server.
  - Supports deployed/local HTTP probing through `HEALTH_AUDIT_BASE_URL`.
  - Validates health JSON contract and fails for:
    - malformed JSON contract
    - Firestore probe failure
    - dashboard endpoint failure
    - critical-interactive route recent failures
    - impossible negative route metrics
    - route registry duplicates/conflicts
- Added route registry validator:
  - `src/observability/route-registry.validation.ts`
  - `src/observability/route-registry.validation.test.ts`
- Improved health status confidence handling:
  - Added `sampleSizeStatus` to each route (`none`, `low`, `usable`, `strong`)
  - Added `coverageClassification` to each route (`observed`, `not_observed_yet`, ...)
  - Critical escalation now requires usable/strong sample size for repeated violations.
  - Single/low-sample routes are marked as "sample too small" instead of being treated as high-confidence critical.
- Added top error signature aggregation:
  - `topErrorSignatures` in dashboard JSON payload for immediate error clustering by signature.
- Added warning-severity aware overall status logic:
  - informational warnings (warming/no-traffic, local probe toggle, single-instance confirmation) no longer force degraded status
  - coherence warning remains degrading when process-local mode is not explicitly safe
- Added coherence-safe single-instance confirmation:
  - `CLOUD_RUN_MAX_INSTANCES=1` now explicitly suppresses process-local warning in production
  - non-production runs are treated as single-instance confirmed for dashboard signal quality
- Added regression test proving dashboard traffic exclusion from app traffic counters:
  - `src/app/createApp.test.ts` now verifies `observedNonDashboardRequests` remains 0 for dashboard-only traffic.
- Added fast empty fallback for suggested friends when viewer identity is absent to avoid expensive pointless fanout.

## Routes Still Degraded/Critical and Why

- Local deterministic `inject` probe currently reports no degraded/critical route rows because no app traffic is injected in that run.
- Production degraded/critical route remediation (feed/map/social/posting hot paths) remains a separate, route-specific optimization pass.

## Exact Commands Run

- `npm run typecheck`
- `npx vitest run src/observability/route-registry.validation.test.ts src/app/createApp.test.ts`
- `HEALTH_AUDIT_MODE=inject npm run health:audit`
- `npx vitest run src/observability/route-registry.validation.test.ts src/observability/config-health.service.test.ts`

## Before / After Health Summary

- Before (dashboard logic baseline):
  - Overall status could be escalated from sparse samples without explicit sample-confidence signaling.
  - No deterministic CLI audit enforcing JSON and registry invariants.
- After (this change set):
  - Deterministic health audit command exists and returns non-zero on hard failures.
  - Route rows include sample size confidence and coverage classification.
  - Overall critical logic is stricter about sample confidence.
  - Overall degraded/critical reflects actionable risk, not purely informational warnings.
  - Top error signatures are surfaced for faster issue triage.

## Env / Deploy Settings

- Optional:
  - `HEALTH_AUDIT_MODE=inject` for local deterministic probes
  - `HEALTH_AUDIT_BASE_URL` for deployed HTTP probes
  - `INTERNAL_DASHBOARD_TOKEN` for protected dashboard access

## Cloud Run Recommendation

- Keep process-local warning visible unless deployment guarantees single-instance behavior.
- If single-instance mode is intended for correctness-sensitive in-memory flows, enforce and document Cloud Run max instances = 1.

## Firestore Indexes Needed

- None introduced by this change set.

## Risks Avoided

- Did not loosen route budgets to force green status.
- Did not remove or fake route functionality.
- Did not change native app contracts or response envelope structure.

## Native App Change Requirement

- Confirmed: no native app changes required for this stabilization pass.
