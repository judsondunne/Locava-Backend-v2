# Surface: Profile Post Detail Hydration (V2)

## Purpose

Provide a clean, dedicated detail-hydration route when a profile grid tile is tapped, while keeping bootstrap and grid pagination lightweight.

## Route

- `GET /v2/profiles/:userId/posts/:postId/detail`

## Contract Summary

- Path params: `userId`, `postId`
- Query: `debugSlowDeferredMs` (internal debug)
- Response sections:
  - `firstRender`: selected post detail needed to open viewer
  - `deferred`: comments preview
  - `background`: prefetch hints
  - `degraded` + `fallbacks`

## First-Render Fields

- selected post core: `postId`, `userId`, `caption`, `createdAtMs`, `mediaType`, `thumbUrl`
- playable assets list (video/image asset objects with startup/main/hls variants where relevant)
- author summary (`userId`, `handle`, `name`, `profilePic`)
- social summary (`likeCount`, `commentCount`, `viewerHasLiked`)
- viewer action flags (`canDelete`, `canReport`)

## Deferred Fields

- comments preview subset

## Background Fields

- prefetch hints for follow-up comment/engagement fetches

## What This Route Intentionally Refuses

- no neighboring post slice
- no giant comment tree
- no unrelated profile-wide payloads
- no broad enrichment fan-out

## Budgets (Initial)

- p50 latency <= 100ms
- p95 latency <= 220ms
- cold db reads target <= 3
- cold db queries target <= 2
- warm-cache reads target 0

## Cache Ownership

- detail cache: `entity:profile-post-detail-v1:{userId}:{postId}:{viewerId}`
- in-flight dedupe: `{userId}:{postId}:{viewerId}`
- cache metrics visible in diagnostics

## Source-of-Truth Integration

Profile post detail now attempts source-of-truth reads for:

- selected post doc: `posts/{postId}` (ownership validated against `:userId`)
- author summary doc: `users/{userId}`

Fallback behavior:

- on timeout/failure, deterministic repository path is used
- timeout/fallback markers are recorded in diagnostics
- temporary adapter cooldown avoids repeated slow-source loops

## Fallback Rules

- comments preview is timeout-bounded and non-blocking
- on timeout/failure:
  - return first-render payload
  - set `degraded: true`
  - add fallback reason
  - record timeout/fallback metadata

## Why This Avoids Old Slow Behavior

- keeps grid and detail separated by contract
- hydrates exactly one selected post on demand
- no batch fan-out on tile open critical path
- deferred comments avoid blocking viewer open
- selected-detail read path stays bounded to minimal docs/fields

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
# denied/internal-only check
curl -sS -o /tmp/profile_post_detail_denied.json -w "%{http_code}\n" \
  "http://localhost:8080/v2/profiles/aXngoh9jeqW35FNM3fq1w9aXdEh1/posts/aXngoh9jeqW35FNM3fq1w9aXdEh1-post-12/detail"

# success detail hydration
curl -sS \
  "http://localhost:8080/v2/profiles/aXngoh9jeqW35FNM3fq1w9aXdEh1/posts/aXngoh9jeqW35FNM3fq1w9aXdEh1-post-12/detail" \
  -H 'x-viewer-id: internal-viewer' \
  -H 'x-viewer-roles: internal' | jq .

# fallback path (slow deferred)
curl -sS \
  "http://localhost:8080/v2/profiles/aXngoh9jeqW35FNM3fq1w9aXdEh1/posts/aXngoh9jeqW35FNM3fq1w9aXdEh1-post-12/detail?debugSlowDeferredMs=300" \
  -H 'x-viewer-id: internal-viewer' \
  -H 'x-viewer-roles: internal' | jq .

# diagnostics verification
curl -sS "http://localhost:8080/diagnostics?limit=20" | jq .
```

## Diagnostics Verification Steps

1. Run denied + success + fallback curl requests.
2. Inspect `/diagnostics?limit=20`.
3. Confirm `profile.postdetail.get` rows show:
   - latency
   - dbOps
   - cache hits/misses
   - timeout/fallback when forced

## Tradeoffs

- current repository is stubbed/scaffolded for controlled contract and performance shape testing.
- deferred comments preview is intentionally small to protect viewer open path.
- deferred comments source integration remains intentionally out of scope for this phase.
