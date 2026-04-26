# Notifications v2 (Read + Write Surface)

Date: 2026-04-20  
Scope: production-grade notifications read/write slice with strict pressure guardrails.

## Entity Model

`NotificationSummary`:

- `notificationId`
- `type` (`like | comment | follow | post`)
- `actorId`
- `actor` (cached `AuthorSummary`)
- `targetId`
- `createdAtMs`
- `readState` (`unread | read`)
- `preview` (`text`, `thumbUrl`)

Intentionally excluded:

- full post/comment/user objects
- nested hydration
- per-notification joins

## Routes

### `GET /v2/notifications`

- Route name: `notifications.list.get`
- Query: `cursor?`, `limit` (10..20)
- Behavior:
  - cursor pagination
  - exactly one repository query for page data
  - no joins/fan-out
  - actor summary served from entity cache when available
  - route cache enabled

### `POST /v2/notifications/mark-read`

- Route name: `notifications.markread.post`
- Body: `{ notificationIds: string[] }` (1..20)
- Idempotent mark-selected-read
- Bounded writes only for unread rows in request set

### `POST /v2/notifications/mark-all-read`

- Route name: `notifications.markallread.post`
- Idempotent bulk mark-read
- Bounded to viewer notification set

## Pagination Strategy

- Sort: `created_desc`
- Cursor encodes tail `{ id, createdAtMs }`
- `nextCursor` emitted only when `hasMore=true`
- first page key is cacheable (`cursor=start`)

## Creation Hooks (Non-Blocking)

Notifications are created from existing mutations:

- like -> notification
- comment -> notification
- follow -> notification

Creation is asynchronous (fire-and-forget in mutation path), keeping mutation response paths non-blocking.

## Invalidation Rules

Scoped only (no global invalidation):

- invalidates notifications first-page route cache keys for viewer (`start` pages for limits 10/15/20)
- used on:
  - notification create hook
  - mark-read
  - mark-all-read

No feed/profile/search global cache invalidation.

## Request Pressure Safety

- list dedupe key: `(viewer, cursor, limit)`
- write dedupe keys: `(viewer, ids)` and `(viewer)`
- concurrency caps:
  - list: 10
  - mark-read: 8
  - mark-all-read: 8
  - creation hook lane: 12
- strict list limit cap (20 max)
- minimal payloads, no fan-out hydration

## Route Policies

- `notifications.list.get`
  - priority: `critical_interactive`
  - latency: p50 80ms / p95 180ms
  - dbOps: reads<=20, queries<=1
  - payload: target 12KB, max 24KB
- `notifications.markread.post`
  - priority: `deferred_interactive`
  - latency: p50 70ms / p95 170ms
  - dbOps: reads<=1, queries<=1
  - payload: target 2.5KB, max 8KB
- `notifications.markallread.post`
  - priority: `deferred_interactive`
  - latency: p50 70ms / p95 170ms
  - dbOps: reads<=1, queries<=1
  - payload: target 2KB, max 8KB

## Intentionally Not Implemented

- realtime listener/socket infrastructure
- expanded type families (chat/group/invite/collection payloads)
- per-item deep hydration of target entities
- rich notification action payloads
- native-client cutover changes

## Verification Commands

```bash
npm test -- src/routes/v2/notifications.routes.test.ts
```

```bash
curl -sS "http://127.0.0.1:8080/v2/notifications?limit=15" \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal"
```

```bash
curl -sS -X POST "http://127.0.0.1:8080/v2/notifications/mark-read" \
  -H "content-type: application/json" \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal" \
  -d '{"notificationIds":["<ID1>","<ID2>"]}'
```

```bash
curl -sS -X POST "http://127.0.0.1:8080/v2/notifications/mark-all-read" \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal"
```

```bash
curl -sS "http://127.0.0.1:8080/diagnostics?limit=80"
```
