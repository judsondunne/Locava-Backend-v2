# Backendv2 Post Detail Hydration (2026-04-24)

## Summary vs Detail Model

- `PostCardSummary` is the lightweight tile model used by feed/map/profile/search/collections/chats/notifications.
- `PostDetail` is the canonical expanded model returned by Backendv2 post detail surfaces.
- Liftable opens instantly with summary shell, then upgrades to detail via post id hydration.

## Endpoint Contracts

- `GET /v2/posts/:postId/detail`
  - canonical single-post hydration endpoint
  - returns detail payload used by Liftable expanded UI
- `POST /v2/posts/details:batch`
  - body: `{ postIds: string[], reason: "prefetch" | "open" | "surface_bootstrap" }`
  - max 15 ids, deduped server-side while preserving input order intent
  - response separates `found`, `missing`, and `forbidden`

## Required Fields

- identity: `postId`, `userId`
- content: `caption`, optional `title`/`description`
- media: `thumbUrl`, `assets[]`, media variants (`startup720FaststartAvc`, `main720Avc`, `hls`)
- author/viewer/social: author summary, like/comment counts, viewer liked/saved, optional follow state
- optional expanded metadata: location, mentions, tags, visibility, deleted/blocked flags

## Cache Strategy

- entity caches:
  - post detail: `postDetail(postId)` TTL
  - social summary: `postSocial(postId)` TTL
  - viewer state: `viewerPostState(viewerId, postId)` TTL
- native shared cache/store:
  - in-memory post detail TTL
  - stale-while-revalidate reads
  - in-flight request dedupe for single and batch hydration

## Invalidation Rules

- detail/social/viewer entities invalidate on:
  - like/unlike
  - save/unsave
  - comment create/delete
  - post edit/delete
- invalidation is performed through mutation invalidation rails in `entity-invalidation`.

## Surface Integration

- shared hydration path is used when Liftable opens from:
  - home/reels feed
  - profile grid
  - collections
  - map
  - search
  - notification/deep link
  - chat shared post
- all these surfaces route through Liftable open + shared post detail hydration.

## Prefetch Rules

- visible-window prefetch uses low-priority behavior and does not block first paint.
- prefetch is bounded (visible subset only), with batch hydration by post id.
- avoids full-list hydration for large feeds/grids/maps.

## Read Budget

- batch endpoint limits IDs per request to control burst read pressure.
- debug diagnostics are included in detail payload:
  - `debugHydrationSource`
  - `debugReads`
  - `debugPostIds`
  - `debugMissingIds`
  - `debugDurationMs`
