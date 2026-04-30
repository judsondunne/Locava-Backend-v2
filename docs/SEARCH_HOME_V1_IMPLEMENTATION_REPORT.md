# Search Home v1 — implementation report

## Endpoint

- **GET** `/v2/search/home-bootstrap` — canonical first paint for Search home (suggested users + exactly **8** activity mix previews).
- **GET** `/v2/search/mixes/:activityKey/page` — cursor-paginated activity posts (same preview projection; `activityKey` may be `biking` or `activity:biking`).

## Response shape (envelope `data`)

- `version`: **1** (number)
- `viewerId`, `generatedAt`
- `suggestedUsers[]`: `{ user, firstPost | null, reason }` — real suggested-friends pipeline; **no fabricated users**
- `activityMixes[]`: length **8** — `{ id, title, activityKey, previewMode: "one"|"three", posts[], nextCursor }`
- `debug?` (with `includeDebug=1`): `routeName: "search.home_bootstrap.v1"`, `cacheStatus`, counts, `postsPerMix`, `payloadBytes`, etc.

## Removed (old)

- **GET** `/v2/search/home/bootstrap` (deleted route + old orchestrator/service/contract).
- Native **`searchHomeV2.api.ts`** / **`SearchV2MixesShelf.tsx`** removed; use **`searchHomeV1.api.ts`** + **`searchHome.store`**.

## Cache keys (backend)

- `search:home:v1:{viewerId}` — full home payload TTL **120s** (orchestrator).
- `search:mixPreview:v1:{activityKey}` — per-activity preview TTL **180s** (service).
- Suggested-friends still uses existing `SuggestedFriendsService` cache.

Invalidation: `search:home:v1:{viewerId}` cleared on **follow/unfollow** and **posting.complete** (see `entity-invalidation.ts`).

## Native

- **Store:** `useSearchHomeStore` (`src/features/search/searchHome.store.ts`)
- **Disk:** MMKV `src/features/search/searchHome.cache.ts`
- **UI:** `SearchHomeSurface` when search query is empty; **`SearchContent.heavy`** when user types (results/typing preserved).

## Tests / checks

- Backend: `src/routes/v2/search-home-v1.routes.test.ts` (requires `FIRESTORE_TEST_MODE` in test env like other route tests).
- Native: `npm run check:syntax` in `Locava-Native`.

## Risks

- Suggested user count and first-post reads scale with candidate list (bounded to 16 users × 1 small posts query each on cold home miss).
- Activity mix preview uses existing `array-contains` + in-memory sort; very large activity sets still cap reads via `poolCap` in repository.
