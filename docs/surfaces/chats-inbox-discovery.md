# Chats Inbox Discovery (Native + Legacy Backend)

Date: 2026-04-20  
Scope: discovery for first safe `chats inbox` v2 slice only (no thread/realtime migration in this phase).

## Files Audited

Native inbox/list:

- `Locava-Native/src/features/chats/data/chatIndex.types.ts`
- `Locava-Native/src/features/chats/data/chatIndex.api.ts`
- `Locava-Native/src/features/chats/data/chatIndex.listener.ts`
- `Locava-Native/src/features/chats/data/chatIndex.store.ts`
- `Locava-Native/src/features/chats/components/ChatRow.tsx`

Legacy backend chat surface:

- `Locava Backend/src/routes/v1/product/chats.routes.ts`
- `Locava Backend/src/routes/chats.routes.ts`
- `Locava Backend/src/controllers/chats.controller.ts`
- `Locava Backend/src/services/chats.service.ts`

## 1) Required Fields to Render Inbox Row

From native row + index typing, required row data is lean:

- `chatId` / conversation id
- `participants` (for ownership + 1:1 inference)
- `isGroupChat`
- `groupName` and `displayPhotoURL` for group rows
- `otherUserId` for 1:1 rows
- optional `otherUserName` / `otherUserPhotoURL` (can be cache-enriched)
- `lastMessageText` (small preview string)
- `lastMessageType` (fallback labels like photo/post/place/collection)
- `lastMessageSenderId`
- `lastMessageTime` (sort + time chip)
- `unread` boolean (derived from seen state/manual unread marker)

## 2) First-Render Needs

Inbox first-render needs only:

- first page of conversation summaries sorted by `lastMessageTime desc`
- unread indicator per row
- stable display name/photo placeholders for rows

No thread messages are required for inbox first render.

## 3) Deferred/Background Data in Current Native Flow

Current native behavior mixes:

- REST bootstrap (`/api/v1/product/chats/bootstrap`) for initial list
- Firestore listener (`participants array-contains`) for live updates
- local cache hydration and profile identity enrichment

Deferred/non-blocking behavior today:

- enrichment of 1:1 participant names/photos from cache
- listener reconciliation after bootstrap
- optimistic row updates after outgoing sends

## 4) Current Pressure Risks

- **Listener + REST overlap:** both can update list around open/resume; merge logic is complex and risk-prone.
- **Duplicate inbox fetches:** bootstrap + listener + modal/focus transitions can cause repeated work.
- **Payload bloat risk:** legacy `fetchUserChats` allows high limits and enrichment fields.
- **Unread drift:** read/unread state comes from `manualUnreadBy` + `lastMessage.seenBy` + local derivation.
- **Per-thread hydration fan-out risk:** if inbox route ever starts fetching messages per chat, pressure explodes.

## 5) Native Assumptions About Sorting + Preview

Native inbox expects:

- newest activity first (`lastMessageTime` descending),
- stable lightweight preview text (`lastMessageText` or type fallback phrase),
- unread dot from row-level state,
- no full message list hydration in inbox path.

## 6) Must Not Include in This Slice

To keep inbox safe and bounded, this phase should **not** include:

- thread message reads (`/messages`)
- typing/presence/realtime transport
- attachments/media hydration
- participant full-profile hydration beyond minimal summary
- per-conversation fan-out calls

## Discovery Conclusion (v2 Inbox Shape)

A safe first v2 inbox slice is:

- one paginated inbox list route returning lean `ConversationSummary` rows
- optional bounded idempotent mark-read route
- route cache + dedupe + concurrency caps
- participant summary cache only where needed
- strict no thread hydration / no realtime in this phase
