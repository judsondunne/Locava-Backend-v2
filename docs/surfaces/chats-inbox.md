# Chats Inbox v2 (First Safe Slice)

Date: 2026-04-20  
Scope: inbox/list only. No thread reads, no realtime transport, no attachment/presence/typing work in this phase.

## Entity Model

`ConversationSummary` (lean inbox row):

- `conversationId`
- `isGroup`
- `title`
- `displayPhotoUrl`
- `participantIds`
- `participantPreview` (bounded `AuthorSummary[]`, max 3)
- `lastMessagePreview`
- `lastMessageType`
- `lastSender` (`AuthorSummary | null`)
- `lastMessageAtMs`
- `unreadCount`
- `muted`
- `archived`

Intentionally excluded:

- thread message payloads
- full participant profile hydration
- attachment metadata hydration
- typing/presence/realtime artifacts

## Routes

### `GET /v2/chats/inbox?cursor&limit`

- Route name: `chats.inbox.get`
- Query: `cursor?`, `limit` (10..20)
- Returns:
  - `requestKey`
  - `page.cursorIn`, `page.nextCursor`, `page.hasMore`
  - lean `items[]`
  - `unread.totalConversationsUnread`

Guarantees:

- cursor pagination
- one bounded repository path per page
- no per-thread fan-out
- route cache + dedupe + concurrency cap
- participant summary cache only

### `POST /v2/chats/:conversationId/mark-read`

- Route name: `chats.markread.post`
- Idempotent bounded write
- Returns unread state + idempotency replay flag + scoped invalidation summary

## Pagination Strategy

- Sort: `last_message_desc` (`lastMessageAtMs` descending)
- Cursor encodes `{ id, createdAtMs }` from page tail
- `nextCursor` only when `hasMore=true`
- cacheable first page (`cursor=start`)

## Request-Pressure Strategy

- strict list limit cap at 20
- one bounded repo path for list page
- no thread/message hydration in inbox route
- dedupe key by `(viewer, cursor, limit)`
- concurrency lane caps:
  - inbox list: 10
  - mark-read: 8
- short route-cache TTL for identical page opens

## Invalidation Rules

For `chat.markread`:

- invalidate only chats inbox first-page route keys (`start` pages for 10/15/20)
- no global chat cache flush

Accepted stale window:

- non-first-page cursors may remain stale until TTL expiration; this is deliberate to prevent cache storms.

## Route Policies

- `chats.inbox.get`
  - priority: `critical_interactive`
  - latency: p50 85ms / p95 190ms
  - dbOps: reads<=20, queries<=1
  - payload: target 13KB, max 26KB
- `chats.markread.post`
  - priority: `deferred_interactive`
  - latency: p50 70ms / p95 170ms
  - dbOps: reads<=1, queries<=1
  - payload: target 2.5KB, max 8KB

## Diagnostics Verification

Validate `/diagnostics` includes:

- `routeName`
- `routePolicy`
- `payloadBytes`
- `dbOps`
- `cache`
- `dedupe`
- `concurrency`
- `invalidation` (mark-read only)
- `budgetViolations` (expected empty)

## Tradeoffs

- This slice prioritizes deterministic, bounded inbox reads over realtime parity.
- mark-read invalidates first-page keys only to avoid invalidation fan-out.
- thread/read receipts migration is explicitly deferred.

## Intentionally Not Implemented Yet

- thread message route family
- realtime listener/socket contracts
- typing indicators
- presence
- rich receipts
- attachment hydration
