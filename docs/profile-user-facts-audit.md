## Profile/User facts audit (Backendv2 + Native)

### Symptoms (production)
- Profile grid shows only a small fixed number of posts (often 6) despite the profile having more.
- Own profile name sometimes hydrates as literal `"Name"`.
- Follow/unfollow mutates relationship, but follower/following counts and relationship state don’t update reliably.
- `/v2/profiles/:userId/bootstrap` frequently serves from cache with `reads=0` immediately after social mutations.
- Repeated `posts/details:batch` cache/entity hits suggest stale post/user projections (author facts) are reused.

### Current implementation map

#### Backendv2 (v2 surfaces)
- **Bootstrap**: `GET /v2/profiles/:userId/bootstrap`
  - Route: `src/routes/v2/profile.routes.ts`
  - Orchestrator: `src/orchestration/surfaces/profile-bootstrap.orchestrator.ts`
  - Service: `src/services/surfaces/profile.service.ts`
  - Repository: `src/repositories/surfaces/profile.repository.ts`
  - Firestore adapter: `src/repositories/source-of-truth/profile-firestore.adapter.ts`
- **Grid page**: `GET /v2/profiles/:userId/grid`
  - Route: `src/routes/v2/profile-grid.routes.ts`
  - Orchestrator: `src/orchestration/surfaces/profile-grid.orchestrator.ts`
  - Repository: `ProfileRepository.getGridPage()`
- **Post detail**: `GET /v2/profiles/:userId/posts/:postId/detail`
  - Route/orchestrator/repo/service in `src/routes/v2/profile-post-detail.routes.ts` and adjacent modules
- **Follow/unfollow**:
  - Routes: `POST /v2/users/:userId/follow`, `POST /v2/users/:userId/unfollow`
  - Orchestrators: `src/orchestration/mutations/user-follow.orchestrator.ts`, `user-unfollow.orchestrator.ts`
  - Invalidation: `src/cache/entity-invalidation.ts`

#### Native
- **Own profile**:
  - Legacy store: `src/features/profile/profile.store.ts` (MMKV cache + v2 bootstrap via `src/data/repos/profileRepo.ts`)
  - V2 store/owner: `src/features/profile/backendv2/profileV2.store.ts`, `profileV2.owner.ts`, `profileV2.repository.ts`
  - UI: `src/features/profile/Profile.heavy.tsx`, header `src/features/profile/ui/ProfileHeader.tsx`
- **Other user profile (UserDisplay)**:
  - V2 owner/store: `src/features/userDisplay/backendv2/userDisplayV2.owner.ts` (bootstraps/paginates via v2 profile endpoints)
  - Legacy fallback uses `src/features/userDisplay/userDisplay.api.ts` (now v2 bootstrap for header only when v2 enabled)
- **Follow/unfollow local sync**:
  - Central hook: `src/features/profile/connectionsSync.ts`

### Root causes found

#### 1) Backend returned “truthy” caches, but invalidation was incomplete for profile facts
Follow/unfollow invalidation cleared:
- `profile.bootstrap` response keys (some limits)
- `profile.relationship`
- user summary / firestore doc / followCounts entity caches

But it **did not clear the profile header/list caches** that directly feed bootstrap composition:
- `entity:profile-header-v1:${userId}` (cached header: name/profilePic/counts)
- `list:profile-grid-preview-v1:${userId}:${limit}` (cached first grid slice)
- grid page caches (start pages)

Effect: immediately after follow/unfollow, bootstrap could hit cached header + cached grid preview (and return `reads=0`), producing stale name/counts/grid.

#### 2) Backend profile service was poisoning shared post-card cache with fabricated author facts
`ProfileService` warmed `entityCacheKeys.postCard(postId)` by constructing a synthetic “PostCardSummary” from the grid preview item alone.

That synthetic payload:
- inferred authorId by parsing postId string
- set `author.name = null`, `author.pic = null`
- set social counts to `0`

Effect: other surfaces that rely on `postCard` cache could hydrate **stale/incorrect author facts** (and “missing name” cascades into client fallbacks).

#### 3) Backend profile grid page size was clamped too small
`ProfileRepository.getGridPage()` clamped `limit` to max `10`, while the contract allows up to `24`.

Effect: clients asking for `12` or `24` could get smaller pages, amplifying the perception of “grid is capped”, especially with caching/pagination.

#### 4) Native UI explicitly renders a literal `"Name"` fallback
`ProfileHeader.tsx` rendered:
- `identity.viewer.name || "Name"`

Effect: any temporarily-empty name (or cached placeholder) shows `"Name"`, which looks like a broken hydration even when backend is correct.

#### 5) Native “own profile” overrides server bootstrap with viewer-store fields (even if placeholder)
`Profile.heavy.tsx` prefers `viewer.store` for self header so edits reflect quickly, but it could override bootstrap name with a placeholder value.

Effect: server-correct name can be replaced by a placeholder during hydration.

### Final source-of-truth model (implemented)

#### Backend
- **Identity fields**: read from `users/{userId}` (via `ProfileFirestoreAdapter.getProfileHeader()` field mask).
- **Follower/following counts**: derived from canonical `users/{userId}/followers` and `users/{userId}/following` subcollections via aggregation (same source as follower/following modals).
- **Post counts**: derived via canonical posts ownership query (with verification caching), never guessed from stale user doc unless verified.
- **Profile grid**:
  - `bootstrap` returns a preview page (`gridPreview`) with a `nextCursor` if more exists.
  - `grid` pages come from canonical profile grid pagination with cursor.

#### Cache rules (implemented changes)
- Viewer relationship state is cached separately (`profile-relationship-v1`).
- Profile header is cached separately (`profile-header-v1`).
- Profile grid preview and page caches are invalidated after relevant mutations.
- Profile grid page cache now includes `viewerId` in the key (v2 key) to prevent cross-viewer bleed and to align with “viewer-scoped surface caches”.

### Invalidation model (implemented changes)

#### Follow/unfollow now invalidates
- **User entities**: user summary/firestore doc/followCounts for both actor and target
- **Profile surfaces**:
  - `entity:profile-header-v1` for both actor and target
  - `list:profile-grid-preview-v1` for both (common limits)
  - `list:profile-grid-page-v2` start pages for both (common limits)
  - `entity:profile-relationship-v1:${viewerId}:${targetId}`
  - `bootstrap:profile-bootstrap-v1:${viewerId}:${targetId}:${gridLimit}` (common limits)
  - self bootstrap equivalents

#### Post create/delete now invalidates owner profile facts
- Clears owner `profile-header-v1`, grid preview, and grid page start caches (in addition to existing post/feed invalidation).

### Native fixes (implemented changes)
- **No literal `"Name"`**: Profile header now resolves display name as:
  - \(name if meaningful and not `"Name"`\) → handle → `"Locava user"`
  - Implemented via `src/features/profile/profileDisplayName.ts`
- **Self-profile hydration**: `Profile.heavy.tsx` now only overrides bootstrap name with viewer-store name when viewer-store name is meaningful (not `"Name"`).
- **Follow/unfollow**: `connectionsSync.ts` now triggers v2 refetches after mutation success:
  - refresh profile v2 surface (if it’s currently showing the target or self)
  - re-bootstrap userDisplay v2 surface (if currently attached)

### Tests/harnesses added
- Backend: `src/routes/v2/profile.routes.test.ts` gained a follow/unfollow freshness test:
  - warm bootstrap to `reads=0`
  - follow
  - assert immediate bootstrap is fresh (`reads>0`) and counts/relationship are correct
  - unfollow
  - assert immediate bootstrap is fresh and counts/relationship revert
- Native: added model test for display name fallback:
  - `src/features/profile/profileDisplayName.model.test.ts`

### Notes / remaining risks
- **Collections GET doing writes**: not addressed in this patch; should be separately audited (read routes must be side-effect free) because it can indirectly affect cache invalidation and “facts” consistency.
- **Legacy UserDisplay (non-v2)** still has its own caches/TTLs; long-term it should converge fully onto v2 surface owners for profile facts to remove duplicate truth paths.

