# Shared Entities Adoption Audit

Date: 2026-04-20  
Scope: existing v2 feed/profile routes only

## Routes Audited

- `GET /v2/feed/bootstrap`
- `GET /v2/feed/page`
- `GET /v2/feed/items/:postId/detail`
- `GET /v2/profiles/:userId/bootstrap`
- `GET /v2/profiles/:userId/grid`
- `GET /v2/profiles/:userId/posts/:postId/detail`

## Findings (Before Hardening)

1. **Shape divergence across surfaces**
   - Feed routes already used `PostCardSummary` semantics and shared contracts.
   - Profile bootstrap/grid/post-detail used route-specific item/detail structures with different author/social naming (`profilePic` vs `pic`, `viewerHasLiked` vs `liked`), creating semantic drift.

2. **Duplicate shaping work**
   - Feed bootstrap/page re-shaped card-like entities in orchestrators even when source records already matched card semantics.
   - Profile grid/bootstrap generated card-like data but did not converge on shared entity construction.

3. **Route-level cache dominance**
   - Caching primarily happened at route/list/bootstrap response level.
   - Entity-level reuse for author/social/viewer/detail fragments was incomplete across profile surfaces.

4. **Repeated work risk**
   - Profile bootstrap/grid could repeatedly build card-like structures for the same post IDs.
   - Detail routes could repeatedly rebuild author/social/viewer fragments.

## Actions Taken

1. **Canonical entity cache layer**
   - Added `src/cache/entity-cache.ts` with canonical keys and shared get-or-set helpers.
   - Integrated with existing in-memory cache and request diagnostics.

2. **Service-layer convergence**
   - Feed service now uses entity cache for:
     - `post:{postId}:card`
     - `post:{postId}:detail`
     - `post:{postId}:social`
     - `user:{userId}:summary`
     - `post:{postId}:viewer:{viewerId}:state`
   - Profile service primes/reuses canonical `PostCardSummary` entities for grid/bootstrap records.
   - Profile post-detail service stores/reuses canonical detail + summary fragments.

3. **Diagnostics guardrails**
   - Added request metrics:
     - `entityCache.hits`
     - `entityCache.misses`
     - `entityConstruction.total`
     - `entityConstruction.types`

4. **Contract compatibility preserved**
   - No external route contract shape changes.
   - Convergence achieved internally via shared semantics + cache reuse.

## Remaining Intentional Compatibility Gaps

- Profile route response fields remain legacy-compatible for now (`profilePic`, `viewerHasLiked`) but are backed by shared entity semantics internally.
- Future breaking-contract phase can fully rename fields if desired, but not part of this hardening pass.

## Verification Snapshot

From `/diagnostics` after valid internal-viewer curl runs:

- `feed.itemdetail.get` shows entity construction and misses on cold open:
  - `entityConstruction.types`: `PostCardSummary`, `AuthorSummary`, `SocialSummary`, `ViewerPostState`, `PostDetail`
  - `entityCache.misses`: `5`
- `profile.postdetail.get` shows canonical detail + summary construction:
  - `entityConstruction.types`: `PostDetail`, `AuthorSummary`, `SocialSummary`, `ViewerPostState`
  - `entityCache.misses`: `4`
- `feed.page.get` and `profile.grid.get` show cache reuse behavior (entity hits on repeated card reads).
- No budget violations observed in sampled requests.

## Practical Impact

- Reduced duplicate entity shaping across feed/profile paths.
- Reduced repeated DB reads for reusable entity fragments.
- Added observability to detect CPU regressions from repeated construction.
