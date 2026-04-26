# Chats Thread v2 (Read Slice)

Date: 2026-04-20  
Scope: first safe thread read route only.

## Entity Model

`MessageSummary` (lean thread row):

- `messageId`
- `conversationId`
- `senderId`
- `sender` (`AuthorSummary`)
- `messageType`
- `text` (nullable)
- `createdAtMs`
- `ownedByViewer`
- `seenByViewer`
- `replyToMessageId` (nullable reference only)

Intentionally excluded:

- attachment hydration payloads
- reaction matrices
- typing/presence/realtime state
- message transport state and listener internals
- nested participant/profile payloads

## Route

### `GET /v2/chats/:conversationId/messages?cursor&limit`

- Route name: `chats.thread.get`
- Query: `cursor?`, `limit` (10..50)
- Returns:
  - `requestKey`
  - `page.cursorIn`, `page.nextCursor`, `page.hasMore`, `page.order`
  - `conversationId`
  - `items[]` (`MessageSummary`)

## Pagination Strategy

- server order: `created_desc`
- cursor encodes tail `{ messageId, createdAtMs }`
- next-page boundary is strict (`< createdAtMs` or tie-break by id)
- no offset paging

## Request-Pressure Strategy

- one bounded repository path/query per page
- strict max page size: 50
- no per-message sender lookups; sender summary comes from seeded row data and optional entity-cache reuse
- route cache key: viewer + conversation + cursor + limit
- in-flight dedupe key: viewer + conversation + cursor + limit
- concurrency-limited repo lane (`maxConcurrentRepoOps: 8`)
- short route-cache TTL to absorb repeat open/focus loads

## Route Policy

- priority: `critical_interactive`
- latency budget: `p50 85ms`, `p95 190ms`
- db budget: `maxReadsCold 50`, `maxQueriesCold 1`
- payload budget: `target 14KB`, `max 28KB`
- cache expectation: `required`
- dedupe expectation: `true`

## Diagnostics Verification

Use `/diagnostics?limit=...` and verify:

- `routeName: chats.thread.get`
- `routePolicy.routeName: chats.thread.get`
- `payloadBytes <= 28000`
- `dbOps.queries <= 1` for cold page
- repeated identical request: warm request `dbOps.reads = 0`, `dbOps.queries = 0`
- `dedupe` and `concurrency` fields present
- `budgetViolations` empty

## Intentionally Not Implemented

- realtime/listener contracts
- attachment/gif/post hydration expansions
- read-receipt matrix and presence semantics

## Tradeoffs

- this slice prioritizes bounded read performance over realtime parity
- sender and seen markers are intentionally minimal for stable first render
- richer thread semantics are deferred to avoid fan-out and payload creep
