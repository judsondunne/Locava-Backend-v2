# Search Results Discovery (v2)

Date: 2026-04-20

## Scope

- Implement lean v2 search committed-results surface first.
- Do not implement multi-mode search (users/places/collections) in v2 yet.
- Do not add search item detail unless required by native first-useful path.

## Native Search Flow Findings

From current native search implementation:

- Typing mode (`useLiveSearch`) calls `/api/v1/product/search/live` with debounce and request abort/stale guards.
- Committed results mode (`useSearchBootstrapPosts`) calls `/api/v1/product/search/bootstrap` and paints quickly from lightweight rows (`postId`, `thumbUrl`, `title`, `activityIds`, optional `lat/lng`).
- Results UI (`SearchResultsSurface`) first useful render is post-card/masonry-like content for the For You tab.
- Native explicitly supports stale suppression (`requestId`, abort controllers, query commit split), and does non-blocking progressive hydration after initial paint.

## What First Useful Results Actually Need

For committed search results first paint, required payload is lightweight post cards:

- identity: `postId`
- visual startup: poster/thumb + media hint
- lightweight author/social/viewer state
- ordering/paging metadata for continuation and stale suppression

Heavy detail is not required for initial committed results render.

## Current Legacy Pressure Risks

Legacy endpoints (`/search/live`, `/search/bootstrap`) show known pressure vectors:

- rapid query churn creates overlapping requests
- repeated same-query work can happen without strict cross-surface entity reuse
- mixed search payload modes can drift into overfetch
- route-level caching exists but shared entity reuse is less explicit than v2 architecture

## Result Item Shape Decision

v2 search results should reuse canonical shared entity:

- `PostCardSummary`

This keeps feed/profile/search aligned and avoids introducing a parallel search-specific card schema.

## What v2 Search Results Intentionally Refuses To Include

This route intentionally excludes:

- full post detail blobs
- comments trees/previews
- heavy media ladders / deep playback variants
- full author profile sections
- users/groups/collections/places mixed modes in the same route
- ranking/relevance debug trees in normal response

## Duplicate Work / Request Pressure Strategy

The route must explicitly support:

- per-query request identity (`requestKey`)
- `queryEcho` + `cursorIn` for client stale suppression
- in-flight dedupe for same normalized query + cursor + limit + viewer
- strict cursor and bounded limits
- short-TTL route cache for repeated pages
- canonical entity cache reuse (`post:{postId}:card`) to avoid repeated card construction

## Search Item Detail Decision

Do **not** add `/v2/search/items/:postId/detail` in this phase.

Reason:

- committed search first useful path is results cards
- existing post detail surfaces already exist for viewer/open flows
- adding another detail surface now would increase route sprawl without first-render benefit

Re-evaluate after search results rollout metrics.
