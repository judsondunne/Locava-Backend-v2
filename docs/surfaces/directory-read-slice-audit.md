# Directory Read Slice Audit (Reconfirmation)

Date: 2026-04-20  
Scope: reconfirm smallest pressure-safe `directory users/search` backend slice.

## 1) First useful directory/search row needs

For native-first render, the row only needs lean identity card fields:

- `userId`
- `handle`
- `name`
- `pic` (nullable)

No first-row dependency exists on profile detail, posts, collections, contact payloads, or graph depth.

## 2) Should first slice be users-only?

Yes. First safe directory slice should remain users-only:

- avoids heavy mixed-entity payloads
- aligns to existing `AuthorSummary` shared entity
- keeps query cardinality bounded and predictable
- prevents contact and graph expansion from coupling into search typing paths

## 3) Required fields for first render

Minimum safe model: canonical `AuthorSummary` semantics:

- `userId`, `handle`, `name`, `pic`

Response metadata required for client request-pressure handling:

- `requestKey`
- `queryEcho`
- `page.cursorIn`
- `page.nextCursor`
- `page.limit`, `page.count`, `page.hasMore`

## 4) Current pressure risks (must explicitly avoid)

1. **Large `/users/all` style pulls**  
   Unbounded list behavior can bog network, phone CPU, and server reads.

2. **Contact matching overlap**  
   Contact ingestion + parse + upload + match can overlap with directory requests and trigger storm patterns.

3. **Graph suggestion overlap**  
   Cohort/location/suggested-user enrich lanes can add fan-out and latency variance.

4. **Duplicate search requests**  
   Same query repeats (focus/open jitter) and distinct query churn (typing) must be collapsed/bounded.

5. **Payload bloat**  
   Broad user schemas and hydrated list rows quickly blow payload budgets on weak devices/networks.

## 5) What this phase intentionally does NOT include

- contact upload/matching/sync
- cohort and most-active-location enrichment
- broad profile hydration
- posts/collections/chat enrich in directory row
- map-directory blended route
- unbounded list parity clone of legacy `/api/users/all`

## Slice decision

Implement only:

- `GET /v2/directory/users?q=...&cursor=...&limit=...`

with strict bounds, users-only payload, route cache, entity cache reuse, in-flight dedupe, repo concurrency capping, and diagnostics-visible budget enforcement.
