# Locava Backend V2 Standards and Conventions

## Core Rules

- Old backend remains source of truth until explicit cutover per surface.
- V2 is built by product surface, not endpoint sprawl.
- Every route is contract-first, observable, and curl-testable.
- No route may bypass route -> orchestrator -> services -> repositories without strong justification.
- Every v2 route must declare a route policy (priority + budgets) in `src/observability/route-policies.ts`.

## Layered Architecture

- `src/routes`: HTTP-only concerns, schema validation, response envelope, request metadata.
- `src/contracts`: request/response contracts and shared schema conventions.
- `src/orchestration`: first-render/deferred/background split, timeout/fallback control, concurrency shaping.
- `src/services`: reusable business logic with no transport coupling.
- `src/repositories`: data-access only (Firestore/other stores), operation accounting.
- `src/cache`: typed cache interfaces, ownership rules, in-flight dedupe.
- `src/observability`: request lifecycle, latency, db ops, classification, diagnostics.
- `src/flags`: per-route/surface cutover and rollout controls.

## Contract Conventions

- Every v2 route defines:
  - `routeName` (stable, dot-delimited, e.g. `profile.bootstrap.get`).
  - query/body schema (Zod).
  - response envelope shape.
  - typed contract object in `src/contracts`.
- Optional/deferred fields must be explicit (`deferred` key) instead of hidden omission.

## Route Conventions

- Route handlers should only:
  - parse/validate input,
  - build viewer context,
  - call one orchestrator entrypoint,
  - map orchestrator output to envelope.
- Route handlers must not call repositories directly.

## Orchestrator Conventions

- Every orchestrator must define:
  - `firstRender` steps,
  - `deferred` steps,
  - timeout plan per step,
  - fallback behavior per step,
  - budget metadata (latency + read targets).
- Orchestrator outputs should include diagnostics metadata for inspection.
- Optional/deferred steps must fail-open with timeout + fallback recording.

## Repository Conventions

- Repository methods return typed objects only (no transport concerns).
- Repository methods increment db operation counters (`reads`, `writes`, `queries`).
- Repository methods expose stable operation names for logs.
- No cross-repository orchestration inside repository layer.

## Cache Conventions

- Cache types:
  - entity cache (`entity:{type}:{id}`),
  - list cache (`list:{surface}:{viewer}:{cursor?}`),
  - bootstrap cache (`bootstrap:{surface}:{viewer}:{shapeVersion}`).
- Cache ownership is defined per surface doc.
- In-flight dedupe required on expensive same-key work.
- Dedupe behavior must be measurable (`dedupe.hits`, `dedupe.misses`).
- Expensive data paths should apply per-key concurrency caps.

## Budgets and Quality Gates

Per surface route, require:

- Latency budget: p50/p95 target in docs.
- Read budget: target + allowed burst bound.
- Payload budget: target + max bytes.
- Route priority: one of `critical_interactive`, `deferred_interactive`, `background`, `internal_debug`.
- Verified curl examples for local and deployed environment.
- Diagnostics visibility:
  - request id,
  - route name,
  - route priority and budget policy,
  - total latency,
  - payload bytes,
  - db ops,
  - cache hit/miss,
  - dedupe metrics,
  - concurrency wait metrics,
  - timeout/fallback usage,
  - error class.

## Rollout and Cutover

- Feature flags gate each surface independently.
- Start with internal traffic only.
- Keep old backend path available for rollback.
- Promote only after budget stability and parity checks.

## Folder Naming Standards

- `src/routes/v2/<surface>.routes.ts`
- `src/contracts/<surface>.contract.ts`
- `src/orchestration/<surface>.orchestrator.ts`
- `src/services/<surface>.service.ts`
- `src/repositories/<surface>.repository.ts`
- `src/cache/<surface>.cache.ts`
- `src/flags/surface-flags.ts`

## Required Per-Surface Docs

For each surface add `docs/surfaces/<surface>.md` with:

- first-render/deferred/background split,
- contract summary,
- latency/read budgets,
- cache policy,
- fallback policy,
- curl test commands,
- rollout/cutover plan.
