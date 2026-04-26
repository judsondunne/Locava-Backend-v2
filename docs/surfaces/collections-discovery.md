# Collections / Saved Discovery (Native + Legacy Backend)

Date: 2026-04-20  
Scope: first safe v2 slice for collections/saved with explicit request-pressure controls.

## Files Audited

Native collections/saved:

- `Locava-Native/src/features/togo/togo.api.ts`
- `Locava-Native/src/features/togo/Togo.content.tsx`
- `Locava-Native/src/data/api/social.api.ts`

Legacy backend:

- `Locava Backend/src/routes/v1/product/collections.routes.ts`
- `Locava Backend/src/controllers/collections.controller.ts`
- `Locava Backend/src/services/collections.service.ts`

V2 architecture references:

- `Locava Backendv2/docs/v2-backend-standards.md`
- `Locava Backendv2/docs/v2-production-guardrails.md`
- `Locava Backendv2/docs/shared-entities.md`
- `Locava Backendv2/docs/entity-cache-strategy.md`
- `Locava Backendv2/docs/mutations-invalidation.md`
- `Locava Backendv2/docs/source-of-truth-integration.md`

## 1) What Collections First Render Actually Needs

From native behavior, first meaningful saved render needs only:

- paginated list of saved post ids for the viewer
- lean post cards matching existing shared `PostCardSummary` semantics
- stable sort (most recent save first)
- cursor continuation metadata (`cursorIn`, `nextCursor`, `hasMore`)

First render does not require full collection management payloads, collaborator metadata, cover upload state, or generated system-mix hydration.

## 2) Saved Only vs Multiple Collections

Current native code mixes two families:

- **Collections hub management** (`/api/v1/product/collections*`) with create/edit/delete/collaborators/system mixes
- **Saved toggle path** via social API (`/api/posts/:postId/save` and delete same path)

For smallest safe parity and pressure control, the slice should be **saved posts only**.  
Multi-collection CRUD is broader and high fan-out; it is not required for first safe parity of save state continuity across feed/profile/detail/collections.

## 3) Required Item Shape

Saved page item can and should be canonical `PostCardSummary`:

- `postId`, `rankToken`
- `author`, `captionPreview`
- `media`, `social`, `viewer`
- `updatedAtMs`

No collection-specific heavy wrapper is needed in this first slice.

## 4) Mutation Inventory (Observed)

Legacy/native mutation surface is broad:

- collection create/update/delete
- collection cover upload
- add/remove collaborator
- add/remove post to collection
- generated mix/blend creation
- mark collection opened
- ensure accent color

But save-state semantics are already represented by lightweight:

- `POST /api/posts/:postId/save`
- `DELETE /api/posts/:postId/save`

For this phase, v2 should implement only:

- `POST /v2/posts/:postId/save`
- `POST /v2/posts/:postId/unsave`

as idempotent bounded mutations.

## 5) Current Pressure Risks

Most relevant risks for this phase:

- oversized saved lists if unbounded limits are allowed
- duplicate same-page fetches on modal open/refocus
- per-item post hydration fan-out if card shaping is done one-by-one through detail paths
- save/unsave drift if invalidation is broad or inconsistent
- invalidation storms if save/unsave flushes feed/profile/search/list caches globally

Legacy collections service confirms heavy paths (owner + collaborator merge, large list assembly, optional per-item media joins) that are explicitly unsafe for first v2 slice.

## 6) Smallest Safe v2 Slice

Preferred slice is confirmed as the correct first implementation:

- `GET /v2/collections/saved?cursor&limit`
- `POST /v2/posts/:postId/save`
- `POST /v2/posts/:postId/unsave`

Implementation constraints:

- cursor pagination only
- strict bounds on `limit`
- one bounded repository list query/path per page
- shared `PostCardSummary` reuse via existing feed shared-entity service
- route cache + entity cache + in-flight dedupe + concurrency limits
- request response includes `requestKey`, `cursorIn`, `nextCursor`
- idempotent save/unsave with scoped invalidation only

## 7) Intentionally Not Included In This Slice

This route family must intentionally exclude:

- multi-collection CRUD management
- collaborator management
- generated/system-mix collection bootstrap
- collection detail/hydration workflows
- collection cover upload/edit metadata
- broad map/directory collection usage
- any broad list-cache flushes across feed/profile/search

## Discovery Conclusion

The next production-safe step is a bounded **saved-posts** surface that reuses existing shared post-card infrastructure and mutation invalidation guardrails.  
This provides meaningful parity for save state and collections entry without introducing high-risk collection-management fan-out or invalidation storms.
