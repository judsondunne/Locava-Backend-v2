# Search Results (v2)

## Route

- `GET /v2/search/results?q=...&cursor=...&limit=...`
- Route name: `search.results.get`
- Cutover: internal-only (`search` surface gating)

## Purpose

Provide fast committed-query post results for search with strict request-pressure guardrails and shared-entity reuse.

## First Useful Result Contract

- Returns lean `PostCardSummary[]` items (no heavy detail hydration).
- Includes stale/out-of-order safety metadata:
  - `requestKey`
  - `queryEcho`
  - `page.cursorIn`
  - `page.nextCursor`

## Shared Entity Reuse

Search results reuses canonical shared entities:

- `PostCardSummary`
- nested: `AuthorSummary`, `SocialSummary`, `ViewerPostState`, `MediaStartupHints`

No parallel search-specific card schema is introduced.

## Source-of-Truth Candidate Retrieval

Candidate retrieval for `search.results` is source-of-truth backed via Firestore adapter:

- collection: `posts`
- indexed field: `searchText` (lowercased prefix field)
- query shape: prefix range + `orderBy(searchText)` + bounded limit
- selected fields only: `feedSlot`, `searchRank`, `updatedAtMs`

Adapter returns candidate post IDs + rank metadata only, then existing shared card path hydrates `PostCardSummary` in batch.

## Request-Pressure Safety Strategy

- **Duplicate same-query work:** in-flight dedupe on `(viewer, normalized query, cursor, limit)` at service layer.
- **Overlapping requests:** bounded concurrency lane for repository work.
- **Rapid query changes:** explicit request identity metadata (`requestKey`) + `queryEcho` for client stale suppression.
- **No hydration storms:** no per-result detail hydration; only card-level entities.
- **No ranking-engine explosion:** repository returns bounded candidate IDs/rank only.
- **Entity reuse:** canonical entity cache for post cards (`post:{postId}:card`).
- **Route cache:** short-TTL page cache for repeated query pages.
- **Pagination discipline:** strict cursor parser + bounded `limit` (`4..12`).
- **Timeout fallback:** strict source timeout, then deterministic fallback path with diagnostics markers.

## Route Budget Policy

- Priority: `critical_interactive`
- Latency: `p50 95ms`, `p95 220ms`
- DB budgets: `maxReadsCold 16`, `maxQueriesCold 2`, warm expected `0/0`
- Payload: `target 18KB`, `max 36KB`
- Cache expectation: `required`
- Concurrency expectation: dedupe true, max concurrent repo ops `4`

## Intentionally Excluded

Search results does **not** include:

- full post detail payloads
- comments trees/previews
- heavy playback ladders
- large author profile sections
- users/groups/collections/places multi-mode search payloads
- ranking debug trees

## Why This Avoids Old Slow Behavior

- One lightweight entity shape prevents response bloat.
- Entity cache + dedupe reduce repeated construction for repeated result IDs.
- Strict bounds on query, cursor, and limit reduce runaway scans.
- No blocking optional work on interactive path.

## Local Curl Commands

Denied / internal-only check:

```bash
curl -i "http://127.0.0.1:8080/v2/search/results?q=hiking"
```

Successful request:

```bash
curl -sS \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal" \
  "http://127.0.0.1:8080/v2/search/results?q=hiking&limit=8"
```

Repeated same-query request:

```bash
curl -sS \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal" \
  "http://127.0.0.1:8080/v2/search/results?q=hiking&limit=8"
curl -sS \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal" \
  "http://127.0.0.1:8080/v2/search/results?q=hiking&limit=8"
```

Pagination:

```bash
curl -sS \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal" \
  "http://127.0.0.1:8080/v2/search/results?q=hiking&limit=8&cursor=cursor:8"
```

Diagnostics verification:

```bash
curl -sS "http://127.0.0.1:8080/diagnostics?limit=50"
```

Verify for `search.results.get`:

- `routeName`, `routePolicy`
- `payloadBytes`
- `dbOps`
- `cache`
- `dedupe`
- `concurrency`
- `entityCache`
- `entityConstruction`
- `fallbacks`, `timeouts`
- `budgetViolations`

## Tradeoffs

- Post-only committed results is intentionally narrow; other search modes remain on legacy paths for now.
- Viewer-specific ranking token remains lightweight and deterministic for stale suppression, not a heavy rank-debug payload.
- Firestore candidate source is bounded by strict scan/timeout rules, so deep-result completeness is intentionally secondary to interactive stability.
