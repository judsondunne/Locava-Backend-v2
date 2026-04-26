# Profile Post Detail Discovery

## Reviewed Paths

- `Locava-Native/src/features/profile/Profile.heavy.tsx` (grid tile rendering + tap flow)
- `Locava-Native/src/features/liftable/PostTile.tsx` (tile tap to viewer open)
- `Locava-Native/src/features/liftable/liftableStore.ts` (open path + background hydration)
- `Locava-Native/src/features/liftable/liftableOpenSnapshot.ts` (what payload is considered "hydrated")
- `Locava-Native/src/data/repos/postRepo.ts` (current detail fetches: `getPost`, `getPostsByIds`)
- legacy backend posts endpoint: `GET /api/posts/:postId`

## Current Open Flow (Profile Tile -> Viewer)

1. Profile grid tile is lightweight (`postId`, `thumbUrl`, media hints).
2. Tile opens liftable viewer immediately with thin payload.
3. Liftable background-hydrates via `postRepo.getPost(postId)` or rich playback hydration.
4. Additional social/comment details may load after initial motion.

## Exact Data Needed for Viewer First Render

Minimum for stable viewer open from profile:

- post identity: `postId`
- core text/time: caption/content, created timestamp
- author summary: `userId`, display name/handle, profile pic
- media assets list with playable URLs/variants (critical for video startup)
- social summary: like count, comment count, viewer-like state
- viewer action state: can delete/report based on ownership

## Deferred Data

Can load after first render without blocking open:

- comments preview/thread subset
- secondary analytics/engagement breakdown
- non-critical badges/decorations

## Neighboring Posts Requirement

From current open flow, viewer opens with selected post only. Neighbor slices are not required on critical path.

Recommendation: keep this contract single-post first; do not include neighboring posts in initial detail contract.

## Likely Old Slowness Causes

- overusing broad `/api/posts/:id` payloads for all surfaces
- ad-hoc background hydration and batch calls from multiple client paths
- mixing first-render and optional enrichment data into one expensive fetch path

## Clean V2 Recommendation

Implement:

- `GET /v2/profiles/:userId/posts/:postId/detail`

Contract should:

- return only one selected post detail payload
- include first-render and deferred sections explicitly
- keep comments preview optional/deferred with timeout fallback
- avoid unrelated fan-out (no adjacent posts, no giant comment trees)
