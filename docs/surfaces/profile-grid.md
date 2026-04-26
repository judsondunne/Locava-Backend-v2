# Surface: Profile Grid Pagination (V2)

## Purpose

Provide cursor-based, lightweight profile post grid pagination without bloating profile bootstrap, safe for heavy users and long scroll sessions.

## Route

- `GET /v2/profiles/:userId/grid`

## Contract Summary

- Path param: `userId`
- Query:
  - `cursor` (optional; format `cursor:<offset>`)
  - `limit` (default `12`, min `6`, max `24`)
- Response:
  - `profileUserId`
  - `items[]` (lightweight grid tiles)
  - `page` metadata (`cursorIn`, `limit`, `count`, `hasMore`, `nextCursor`, `sort`)
  - `degraded` and `fallbacks`

## Item Shape (Lightweight)

Each item contains only:

- `postId`
- `thumbUrl`
- `mediaType`
- `aspectRatio` (optional)
- `updatedAtMs`
- `processing` / `processingFailed` (optional)

No full post detail objects are returned.

## Cursor Strategy

- Ordering: deterministic `updatedAtMs_desc` (newest first)
- Cursor format: `cursor:<offset>`
- First page: no cursor (offset 0)
- Next page: uses returned `nextCursor`
- Invalid cursor: fallback to first page with degraded metadata

## Budgets

- p50 latency target: <= 90ms
- p95 latency target: <= 200ms
- default page limit: 12
- max page limit: 24
- cold DB budget target: <= 24 reads, <= 1 query per page
- warm-cache DB budget target: 0 reads, 0 queries (cache hit)

## Cache Ownership

- Grid page cache: `list:profile-grid-page-v1:{userId}:{cursor|start}:{limit}`
- In-flight dedupe in service layer by `{userId}:{cursor}:{limit}`
- Cache behavior visible via diagnostics `cache.hits/misses`

## Fallback Rules

- Invalid cursor falls back to first page (`degraded=true`, fallback reason recorded)
- No heavy optional enrichment in this route, so no timeout branches needed

## Why This Avoids Old Slow Behavior

- strict bounded page sizes
- cursor pagination, no load-all behavior
- lightweight tile payloads only
- no post hydration fan-out inside pagination route
- independent from bootstrap to keep profile open path lean

## Local Run

```bash
cd "Locava Backendv2"
npm install
npm run test
npm run build
npm run dev
```

## Curl Commands (Local)

```bash
# 1) denied/internal-only check
curl -sS -o /tmp/profile_grid_denied.json -w "%{http_code}\n" \
  "http://localhost:8080/v2/profiles/aXngoh9jeqW35FNM3fq1w9aXdEh1/grid"

# 2) first grid page for heavy user
curl -sS \
  "http://localhost:8080/v2/profiles/aXngoh9jeqW35FNM3fq1w9aXdEh1/grid?limit=12" \
  -H 'x-viewer-id: internal-viewer' \
  -H 'x-viewer-roles: internal' | jq .

# 3) next page using returned cursor (example cursor: cursor:12)
curl -sS \
  "http://localhost:8080/v2/profiles/aXngoh9jeqW35FNM3fq1w9aXdEh1/grid?limit=12&cursor=cursor:12" \
  -H 'x-viewer-id: internal-viewer' \
  -H 'x-viewer-roles: internal' | jq .

# 4) limit boundary test
curl -sS \
  "http://localhost:8080/v2/profiles/aXngoh9jeqW35FNM3fq1w9aXdEh1/grid?limit=24" \
  -H 'x-viewer-id: internal-viewer' \
  -H 'x-viewer-roles: internal' | jq .

# 5) diagnostics verification
curl -sS "http://localhost:8080/diagnostics?limit=20" | jq .
```

## Diagnostics Verification Steps

1. Call denied + first page + next page + invalid cursor path.
2. Inspect `/diagnostics?limit=20`.
3. Confirm `routeName=profile.grid.get` entries include:
   - latency
   - dbOps
   - cache hits/misses
   - fallbacks when invalid cursor used

## Tradeoffs

- Cursor currently uses offset format for simplicity; repository API is shaped so this can move to document-based cursors later without route contract churn.
- Route intentionally avoids enrichment hooks to guarantee stable pagination latency.
