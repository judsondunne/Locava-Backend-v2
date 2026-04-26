# Chats Thread Discovery (Native + Legacy Backend)

Date: 2026-04-20  
Scope: first safe v2 thread **read-only** slice (`GET /v2/chats/:conversationId/messages`) with pressure guardrails.

## Files Audited

Native thread:

- `Locava-Native/src/features/chatThread/data/thread.types.ts`
- `Locava-Native/src/features/chatThread/data/thread.listener.ts`
- `Locava-Native/src/features/chatThread/data/thread.store.ts`
- `Locava-Native/src/features/chatThread/data/thread.cache.ts`
- `Locava-Native/src/features/chatThread/data/thread.utils.ts`
- `Locava-Native/src/features/chatThread/components/MessageList.tsx`
- `Locava-Native/src/features/chatThread/components/MessageBubble.tsx`

Legacy backend thread path:

- `Locava Backend/src/routes/v1/product/chats.routes.ts`
- `Locava Backend/src/controllers/chats.controller.ts` (`getChatMessages`)
- `Locava Backend/src/services/chats.service.ts` (`getChatMessages`, `markMessagesAsSeen`)

## 1) Required Fields to Render a Thread Message Row

From native message list/bubble types, thread row can be kept lean for first read slice:

- `messageId`
- `conversationId`
- `senderId`
- optional sender display summary (`senderName`, `senderProfilePic`) if available/cached
- `messageType`
- `content` (text body or fallback label)
- `createdAtMs`
- `ownedByViewer` (derived in route/service)
- optional minimal `seenBy` marker only if needed for coarse seen/delivered badge
- optional `replyToMessageId` reference only (no reply hydration)

## 2) First-Render Needs

Thread first-render needs:

- first page of newest messages (native listener currently uses desc limit 50 then reverses for display)
- stable sender identity for bubble header/avatar in group thread contexts
- text/photo/post/place/collection fallback labels

No attachment metadata fetch or full referenced-object hydration is required for first render.

## 3) Deferred/Background Data in Current Native Flow

Current native thread is listener-centric:

- Firestore `onSnapshot` on `chats/{chatId}/messages` ordered by timestamp desc + limit 50
- local cache hydrate on open (`thread.cache`)
- optimistic message merge/reconcile in store
- auxiliary realtime lanes for typing/last-active/reactions exist outside base read list

For v2 read slice, deferred/realtime ownership is intentionally out of scope.

## 4) Current Pressure Risks

- **Listener + REST overlap:** thread can be bootstrapped while listener also streams updates.
- **Repeated open/focus fetches:** thread opens often and can re-request same page.
- **Payload bloat:** message rows currently can include photo/gif/post payload fields and sender metadata.
- **Attachment hydration risk:** photo/post/gif rich payloads can inflate response bytes quickly.
- **Receipt/read-state drift:** `seenBy` + local optimistic updates can diverge under race windows.
- **Per-message sender hydration fan-out:** naive user fetch per message is unacceptable.

## 5) Native Assumptions: Ordering, Paging Direction, Unread Boundary

Observed assumptions:

- storage/query path is newest-first; UI display order is oldest-first after client reversal
- page window is bounded (~50 today)
- message row status indicators rely on lightweight seen markers and sender ownership
- unread boundary is managed primarily by mark-seen behavior and listener reconciliation

Safe v2 implication:

- keep server route sorted newest-desc with cursor by `(createdAtMs, messageId)`, and let client/UI reverse if needed.

## 6) Must Not Include in This Slice

To keep thread read bounded and production-safe, this phase should not include:

- send-message mutations
- realtime transport/listener contracts
- attachment media fetch/hydration
- reactions, typing, presence, rich receipts matrices
- per-message fan-out lookups for sender or referenced entities

## Discovery Conclusion (v2 Thread Read Shape)

A safe first thread read slice should be:

- cursor-paginated read route with strict limits
- one bounded repository path per page
- lean `MessageSummary` only
- sender summary reuse via entity cache only (no per-message extra queries)
- route cache + dedupe + concurrency cap
- explicit diagnostics budget verification
