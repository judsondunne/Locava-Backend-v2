# Surface: Auth / Session / Bootstrap (V2)

## Routes

- `GET /v2/auth/session`
- `GET /v2/bootstrap`

## Purpose

This surface proves the v2 architecture template end-to-end with strict layering, lean payloads, fallback handling, cache readiness, and observable behavior before broader migration.

## Contract Summary

### `GET /v2/auth/session`

- Query: `debugSlowDeferredMs` (optional, internal debug)
- Returns:
  - `firstRender`: auth state + minimal viewer/session summary
  - `deferred`: `viewerSummary` (nullable)
  - `background`: cache warm signal
  - `degraded` + `fallbacks`

### `GET /v2/bootstrap`

- Query: `debugSlowDeferredMs` (optional, internal debug)
- Returns:
  - `firstRender`: app version/time + minimal viewer + shell basics
  - `deferred`: experiments list
  - `background`: cache warm signal
  - `degraded` + `fallbacks`

## First-Render vs Deferred vs Background

- First-render:
  - session validity
  - viewer identity/role
  - minimal bootstrap shell data
- Deferred:
  - viewer summary / experiments
- Background-only:
  - cache warming and non-blocking optimization hooks

## Initial Budgets

- `GET /v2/auth/session`
  - latency budget: p50 <= 90ms, p95 <= 200ms
  - db read budget: <= 2 reads typical, <= 3 with deferred enrichment
- `GET /v2/bootstrap`
  - latency budget: p50 <= 120ms, p95 <= 260ms
  - db read budget: <= 3 reads typical, <= 4 with deferred enrichment

## Fallback Rules

- If deferred enrichment exceeds timeout:
  - return first-render payload without blocking
  - mark `degraded: true`
  - append fallback reason in `fallbacks`
  - record timeout/fallback in diagnostics

## Cache Plan

- Session summary cache key: `entity:session-v1:{viewerId}`
- Bootstrap cache key: `bootstrap:init-v1:{viewerId}`
- In-flight dedupe for repeated same-key loads to prevent duplicate backend work

## Cutover Notes

- Surface is internal-only gated via viewer role (`x-viewer-roles: internal`).
- Route is denied with `403` for non-internal viewers.
- Old backend remains source of truth until explicit migration rollout.

## Local Run

```bash
cd "Locava Backendv2"
npm install
npm run dev
```

## Curl Commands (Local)

```bash
# denied (non-internal)
curl -sS http://localhost:8080/v2/auth/session | jq .

# internal session
curl -sS http://localhost:8080/v2/auth/session \
  -H 'x-viewer-id: user-123' \
  -H 'x-viewer-roles: internal' | jq .

# internal bootstrap
curl -sS http://localhost:8080/v2/bootstrap \
  -H 'x-viewer-id: user-123' \
  -H 'x-viewer-roles: internal' | jq .

# force deferred fallback path
curl -sS 'http://localhost:8080/v2/bootstrap?debugSlowDeferredMs=300' \
  -H 'x-viewer-id: user-123' \
  -H 'x-viewer-roles: internal' | jq .

# inspect diagnostics
curl -sS 'http://localhost:8080/diagnostics?limit=20' | jq .
```

## Curl Commands (Deployed)

```bash
SERVICE_URL="https://<cloud-run-url>"

curl -sS "$SERVICE_URL/v2/auth/session" \
  -H 'x-viewer-id: user-123' \
  -H 'x-viewer-roles: internal' | jq .

curl -sS "$SERVICE_URL/v2/bootstrap" \
  -H 'x-viewer-id: user-123' \
  -H 'x-viewer-roles: internal' | jq .

curl -sS "$SERVICE_URL/diagnostics?limit=20" | jq .
```

## Diagnostics Verification Steps

1. Call both v2 routes with internal role header.
2. Call `/diagnostics?limit=20`.
3. Confirm entries include:
   - `routeName` (`auth.session.get`, `bootstrap.init.get`)
   - `latencyMs`
   - `dbOps`
   - `cache.hits` / `cache.misses`
   - `timeouts` / `fallbacks` (when forced)
