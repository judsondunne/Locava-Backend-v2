# Directory Surface (v2 Lean Users/Search Slice)

Date: 2026-04-20  
Scope: first safe, users-only directory read route.

## Implemented Route

- `GET /v2/directory/users?q=...&cursor=...&limit=...`

## Exact Safe First Slice

Returns users-only directory rows with canonical `AuthorSummary` fields:

- `userId`
- `handle`
- `name`
- `pic` (nullable)

And request-pressure metadata:

- `requestKey`
- `queryEcho`
- `page.cursorIn`, `page.nextCursor`
- `page.limit`, `page.count`, `page.hasMore`

## Entity model

- Reuses shared `AuthorSummary` semantics and user summary entity cache key (`user:{userId}:summary`).
- Does not introduce a new profile schema or hydration layer.

## Source strategy

- Reuses bounded search-users source adapter behavior for first safe directory query path.
- Strict bounded query behavior:
  - `limit` range `5..12`
  - cursor paging only
  - no unbounded list pulls
  - selected user summary fields only

## Request-pressure strategy

- route cache (`directory-users-v1`, short TTL)
- in-flight dedupe key: `(viewer, normalized query, cursor, limit)`
- repository concurrency cap: `directory-users-page-repo`, max `4`
- entity cache reuse for `AuthorSummary`
- diagnostics-visible budget checks (`latency`, `dbOps`, `payload`)

## Route policy

`directory.users.get`:

- priority: `critical_interactive`
- latency: `p50 85ms`, `p95 200ms`
- dbOps: `maxReadsCold 24`, `maxQueriesCold 3`
- payload: `target 10KB`, `max 20KB`
- cache expectation: `required`
- concurrency expectation: dedupe enabled, max repo ops 4

## Intentionally not implemented

- contact ingestion/matching/address-book sync
- cohort/location user enrichment
- graph breadth enrichment
- posts, collections, chat, or map hydration in directory rows
- giant user-list payloads or `/users/all` parity clone

## Curl verification

Cold query:

`curl -s -H "x-viewer-id: internal-viewer" -H "x-viewer-roles: internal" "http://127.0.0.1:8080/v2/directory/users?q=creator&limit=8"`

Repeated identical query:

`curl -s -H "x-viewer-id: internal-viewer" -H "x-viewer-roles: internal" "http://127.0.0.1:8080/v2/directory/users?q=creator&limit=8"`

Rapid query churn:

`curl -s -H "x-viewer-id: internal-viewer" -H "x-viewer-roles: internal" "http://127.0.0.1:8080/v2/directory/users?q=crea&limit=8"`

`curl -s -H "x-viewer-id: internal-viewer" -H "x-viewer-roles: internal" "http://127.0.0.1:8080/v2/directory/users?q=creat&limit=8"`

`curl -s -H "x-viewer-id: internal-viewer" -H "x-viewer-roles: internal" "http://127.0.0.1:8080/v2/directory/users?q=creator&limit=8"`

Diagnostics verification:

`curl -s "http://127.0.0.1:8080/diagnostics?limit=80"`

Verify:

- `routeName = directory.users.get`
- `routePolicy` attached
- `payloadBytes`, `dbOps`
- `cache`, `dedupe`, `concurrency`
- `fallbacks`, `timeouts`
- `budgetViolations` empty in normal flow

## Tradeoffs

- This slice intentionally favors pressure safety over enrichment breadth.
- Graph/contact-heavy directory value is deferred to later phases.
- Source fallback markers currently reference shared search-users adapter naming and remain visible in diagnostics for operational clarity.
