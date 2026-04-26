# Surface: Profile Bootstrap (V2)

## Purpose

Open profile quickly with a lean payload even for heavy users (200+ posts), without overfetching full history or triggering per-post enrichment storms.

## Route

- `GET /v2/profiles/:userId/bootstrap`

## Contract Summary

- Path param: `userId`
- Query:
  - `gridLimit` (default `12`, min `6`, max `18`)
  - `debugSlowDeferredMs` (internal debug)
- Response:
  - `firstRender`
    - profile summary (identity + own-profile flag)
    - counts summary
    - viewer relationship state
    - tab metadata
    - grid preview (lightweight items only + `nextCursor`)
  - `deferred`
    - badge summary (optional)
  - `background`
    - cache warm/prefetch hints
  - `degraded` + `fallbacks`

## First-Render / Deferred / Background Split

- First-render:
  - profile header summary
  - counts
  - relationship
  - tabs
  - first lightweight grid slice
- Deferred:
  - profile badge summary
- Background:
  - cache warming and prefetch hints

## Budgets (Initial)

- Profile bootstrap latency:
  - p50 <= 110ms
  - p95 <= 260ms
- DB budget:
  - typical <= 16 reads (cold first request with 12-tile grid preview)
  - warm-cache target <= 4 reads
  - typical <= 4 queries
- Grid preview cap:
  - default 12
  - hard max 18
- Payload principle:
  - no full post hydration in bootstrap
  - grid preview tile only

## Cache Ownership

- Header cache: `entity:profile-header-v1:{userId}`
- Relationship cache: `entity:profile-relationship-v1:{viewerId}:{userId}`
- Grid preview cache: `list:profile-grid-preview-v1:{userId}:{limit}`
- Shaped bootstrap cache: `bootstrap:profile-bootstrap-v1:{viewerId}:{userId}:{limit}`
- In-flight dedupe active in service layer

## Source-of-Truth Integration

Profile bootstrap now attempts source-of-truth reads for:

- header/counts from `users/{userId}`
- relationship from following docs
- bounded preview from `posts` by `userId` with deterministic order

Fallback behavior:

- if source call fails or times out, deterministic repository fallback is used
- timeout/fallback markers are recorded in diagnostics
- temporary adapter cooldown prevents repeated slow-source loops

## Fallback Rules

- Deferred badge summary timeout does not block base response.
- On timeout/failure:
  - return first-render profile payload
  - set `degraded: true`
  - append fallback reason
  - record timeout/fallback in diagnostics

## Pagination Strategy

- Bootstrap returns first grid slice + `nextCursor` only.
- No unbounded profile history fetch.
- Follow-up route for pagination is recommended next (`/v2/profiles/:userId/grid`) rather than inflating bootstrap.

## Why This Avoids Old Slow Behavior

- first page is strictly capped (no large default 30+ unless explicit and bounded)
- no load-all-then-slice
- no full post payload fan-out in bootstrap
- optional work is deferred and timeout-protected
- per-request cache/read/fallback observability is explicit
- preview remains bounded and does not hydrate post details per tile

## Intentionally Not Integrated

- full profile grid continuation pagination source path
- deferred badge enrichment source path

## Cutover Notes

- internal-only gated via `x-viewer-roles: internal`
- old backend remains source of truth during migration

## Run Commands

```bash
cd "Locava Backendv2"
npm install
npm run test
npm run build
npm run dev
```

## Curl Commands (Local)

```bash
# denied (non-internal)
curl -sS -o /tmp/profile_denied.json -w "%{http_code}\n" \
  "http://localhost:8080/v2/profiles/aXngoh9jeqW35FNM3fq1w9aXdEh1/bootstrap"

# heavy-user success (primary perf case)
curl -sS \
  "http://localhost:8080/v2/profiles/aXngoh9jeqW35FNM3fq1w9aXdEh1/bootstrap?gridLimit=12" \
  -H 'x-viewer-id: internal-viewer' \
  -H 'x-viewer-roles: internal' | jq .

# forced fallback path
curl -sS \
  "http://localhost:8080/v2/profiles/aXngoh9jeqW35FNM3fq1w9aXdEh1/bootstrap?gridLimit=12&debugSlowDeferredMs=300" \
  -H 'x-viewer-id: internal-viewer' \
  -H 'x-viewer-roles: internal' | jq .

# diagnostics check
curl -sS "http://localhost:8080/diagnostics?limit=20" | jq .
```

## Curl Commands (Deployed)

```bash
SERVICE_URL="https://<cloud-run-url>"

curl -sS \
  "$SERVICE_URL/v2/profiles/aXngoh9jeqW35FNM3fq1w9aXdEh1/bootstrap?gridLimit=12" \
  -H 'x-viewer-id: internal-viewer' \
  -H 'x-viewer-roles: internal' | jq .

curl -sS "$SERVICE_URL/diagnostics?limit=20" | jq .
```

## Diagnostics Verification Steps

1. Run denied + success + forced fallback requests.
2. Inspect `/diagnostics?limit=20`.
3. Confirm for `routeName=profile.bootstrap.get`:
   - latency present
   - dbOps present
   - cache hits/misses present
   - fallback/timeout entries present for forced slow path
