# Chats Send Message Discovery (Native + Legacy Backend)

Date: 2026-04-20  
Scope: text-message send mutation discovery for v2 control-plane implementation.

## Files Audited

Native:

- `Locava-Native/src/features/chatThread/data/thread.send.ts`
- `Locava-Native/src/features/chatThread/ChatThread.content.tsx`
- `Locava-Native/src/features/chatThread/components/ComposerBar.tsx`
- `Locava-Native/src/features/chatThread/data/thread.store.ts`

Legacy backend:

- `Locava Backend/src/controllers/chats.controller.ts`
- `Locava Backend/src/services/chats.service.ts`

## 1) Required Fields To Send Message

Native send-text path currently sends:

- `chatId`
- `content`
- `senderId`
- optional `replyingTo` via separate endpoint

For first v2 text-only slice, minimal required fields are:

- `conversationId` (path)
- `text` (body)
- optional `clientMessageId` (body; idempotency key)

## 2) How Client Generates Message IDs

Native generates an optimistic id:

- `generateClientId(): opt_${Date.now()}_${random}`

This id is currently client-only UI identity and is not used by legacy backend for idempotent dedupe.

## 3) Current Retry Behavior

- Native sends optimistic message immediately.
- On success, optimistic row is reconciled to server message.
- On failure, optimistic row marked failed.
- Resend/tap-again behavior can create additional send calls.
- Legacy backend generally performs direct add/write per call and does not enforce idempotent text send by client key.

## 4) Ordering Assumptions

Native assumes:

- server/source order is timestamp-desc for retrieval
- UI reverses for display-oldest-first
- recently sent message should appear in consistent temporal order with server-confirmed messages

Legacy writes use server timestamp, but repeated sends can still produce multiple rows close in time.

## 5) Duplicate Tap Behavior

- Rapid taps call send repeatedly.
- Without server-side idempotency, duplicate messages may be created.
- Native optimistic merge heuristics reduce visible duplicates sometimes, but do not provide hard write guarantees.

## 6) Slow Network / Resend Behavior

- Slow or ambiguous responses can lead users to resend.
- Legacy behavior may create additional writes because request replay is not keyed by client mutation id.

## 7) Inbox + Thread Update Expectations

Expected UX after successful send:

- thread includes newly sent message in correct server order
- inbox row updates with latest preview + `lastMessageAtMs`
- unread counts remain coherent (typically unread for sender stays zero)

## Discovery Risks To Address In v2 Send Slice

- duplicate creation under tap/retry storms
- race/order issues from overlapping sends in same conversation
- broad invalidation causing cache storms
- listener + REST overlap assumptions from old system

## Discovery Conclusion

A safe v2 send-text mutation must:

- require server-controlled timestamp/order
- accept optional `clientMessageId` and enforce idempotent replay
- serialize writes per `(viewer, conversation)` to avoid race/out-of-order inserts
- update thread + inbox source rows in one bounded mutation path
- perform scoped invalidation only for affected thread keys and inbox first-page keys
