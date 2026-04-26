# Comments Discovery (Native -> v2)

Date: 2026-04-20  
Scope: native comment usage and minimal backend-safe v2 comments surface design.

## Native Findings

## 1) Required fields to render comment rows

Native row rendering and thread state relies on:

- `id/commentId` (stable key and action target)
- `postId`
- author fields (`userId`, display name/handle, avatar)
- `text/content`
- `createdAtMs/time`
- viewer ownership and liked flags (for controls)
- lightweight counts (`likeCount`, reply count derived in native today)

The first v2 slice should provide enough for row rendering and core actions only.

## 2) Replies on first render

- Native currently can carry nested replies in existing v1 payloads.
- For this v2 phase, replies are intentionally excluded from first render.
- top-level comments only is acceptable and required to control fan-out/payload.

## 3) Pagination behavior

- Native v1 path does not use robust pagination in comments flow.
- v2 will provide strict cursor pagination for top-level comments:
  - default 10
  - min 5
  - max 20

## 4) Mutations observed

- create comment
- delete comment
- like-comment exists in native v1 but is out of scope for this v2 slice
- edit comment not required in this phase

## 5) Performance risks discovered

- full-tree payload behavior risks bloat and hydration churn,
- replies eager-loading despite collapsed UI,
- repeated loads and post-mutation full refresh risk duplicate work,
- mutation bursts can cause request storms if not idempotent and lock-protected.

## 6) v2 design constraints from discovery

- no nested tree/reply expansion in base read route,
- one-query page fetch only,
- no per-comment fan-out query pattern,
- bounded payload,
- idempotent create/delete,
- scoped invalidation only (detail + deterministic comment list keys).
