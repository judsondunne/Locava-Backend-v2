# Notifications Discovery (Native -> v2)

Date: 2026-04-20  
Scope: native notification usage and pressure risks for v2 notifications read/write surface.

## Native Files Audited

- `Locava-Native/src/features/notifications/notifications.types.ts`
- `Locava-Native/src/features/notifications/notifications.api.ts`
- `Locava-Native/src/features/notifications/state/notification.repository.ts`
- `Locava-Native/src/features/notifications/notifications.listModel.ts`
- `Locava-Native/src/features/notifications/state/notificationState.model.ts`

## Required Fields per Notification (Observed)

Native list behavior needs lightweight fields:

- `id`
- `type`
- `senderUserId` / sender summary
- target reference (`postId` / `commentId` / `userId`)
- timestamp (`createdAtMs` equivalent)
- read state (`seen` or `read`)
- minimal preview (`message`, optional post thumbnail)

Native can handle richer metadata, but first v2 slice should stay minimal.

## Notification Types Found

Native type union includes:

- core: `like`, `comment`, `follow`, `post`
- extended/system: `contact_joined`, `invite`, `group_invite`, `group_joined`, `collection_shared`, `addedCollaborator`, `mention`, `chat`, `groupChat`

First v2 slice focuses on high-frequency core mutation-driven types:

- `like`, `comment`, `follow` (+ `post` as reserved type in contract)

## First-Render Needs

On open, native performs:

- list bootstrap with page + unread count,
- lightweight display grouped by date buckets in UI layer.

This supports a compact v2 first-render payload:

- page of `NotificationSummary[]`
- `unread.count`
- cursor pagination metadata

## Pagination Behavior Found

Native old path uses page/limit style (`page`, `limit`, often defaulting to high limits like 50).  
v2 should convert to cursor pagination to avoid over-fetching and duplicate page overlap races.

## Current Pressure Risks

- **Fan-out risk:** over-enriching each notification with post/user/comment details.
- **Duplicate fetches:** modal open + refresh + badge fetch overlap.
- **Payload bloat:** high limits and optional metadata blobs in list payloads.
- **Unread drift:** separate unread stats requests can diverge from list state.
- **Over-fetching related entities:** per-notification hydration multiplies request pressure.

## Discovery Conclusions for v2 Shape

- Keep notification row minimal and self-contained.
- No per-item hydration except actor summary (entity cache eligible).
- One-query paginated list read path.
- Idempotent mark-read and mark-all-read writes.
- Non-blocking creation hooks from existing mutations.
