# Chats Send Message v2 (Text-Only Control Plane)

Date: 2026-04-20  
Scope: idempotent text send mutation only.

## Mutation Model

Route:

- `POST /v2/chats/:conversationId/messages`
- routeName: `chats.sendtext.post`

Body:

- `text` (required, 1..600)
- `clientMessageId` (optional, 8..128; idempotency key)

Response:

- minimal `message` (`MessageSummary`)
- `idempotency.replayed`
- scoped invalidation summary

## Idempotency Strategy

- idempotency key is `(viewerId, conversationId, clientMessageId)`.
- same key returns the original message (`replayed: true`) without duplicate write.
- mutation lock serializes writes per `(viewerId, conversationId)` to prevent race inserts.
- in-flight dedupe collapses overlapping duplicate submits in-process.

## Ordering Guarantees

- server is source of truth for `createdAtMs`.
- on insert, timestamp is monotonic (`max(now, previousHead.createdAtMs + 1)`).
- thread read remains consistent with existing `created_desc` cursor strategy.

## Invalidation Rules

`chat.sendtext` invalidates only:

- thread route keys for the affected conversation (`chats-thread-v1` start cursors)
- inbox first-page keys (`chats-inbox-v1` start keys 10/15/20)

Intentionally no global cache flush.

## Retry Behavior

- retry with same `clientMessageId`: safe replay, no duplicate message.
- retry without `clientMessageId`: treated as new send.
- rapid tap storms with stable client key collapse to one write + replays.

## Request-Pressure Safety

- bounded mutation path in one repository call
- no fan-out reads/writes
- no attachment hydration
- no realtime/listener coupling
- diagnostics expose dedupe/concurrency/idempotency/invalidation/budget fields

## Route Policy

- priority: `critical_interactive`
- latency: `p50 80ms`, `p95 180ms`
- dbOps: `maxReadsCold 1`, `maxQueriesCold 1`
- payload: `target 4KB`, `max 12KB`
- concurrency expectation: dedupe expected, `maxConcurrentRepoOps 6`

## Intentionally Not Implemented

- attachments/media send
- typing/presence/realtime transport
- delivery/read receipt matrix
- reply threading mutation fields
