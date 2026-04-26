# Autofill V1/V2 Parity Audit (2026-04-24)

## Scope

This audit covers Locava search autofill/autocomplete parity between:

- Old backend v1 (`Locava Backend`)
- Current backend v2 (`Locava Backendv2`)
- Native search integration (`Locava-Native`)

Focus areas:

- search input autofill / autocomplete
- activity + region/place suggestions
- user/post/collection suggestion surfaces
- typing vs submit behavior
- map handoff behavior
- request/response contracts
- ranking, fallback, cache, and latency behavior

---

## Old Native Files Involved

- `Locava-Native/src/features/search/SearchModalGate.tsx`
- `Locava-Native/src/features/search/SearchContent.heavy.tsx`
- `Locava-Native/src/features/search/useSearchAutofill.ts`
- `Locava-Native/src/features/search/useLiveSearch.ts`
- `Locava-Native/src/features/search/useSearchLiveSnapshot.ts`
- `Locava-Native/src/features/search/useSearchBootstrapPosts.ts`
- `Locava-Native/src/features/search/useMixSearchSuggest.ts`
- `Locava-Native/src/features/search/searchLiveSurface.tsx`
- `Locava-Native/src/features/search/searchResultsSurface.tsx`
- `Locava-Native/src/features/search/searchRecent.cache.ts`
- `Locava-Native/src/features/search/searchQuerySemantics.ts`
- `Locava-Native/src/features/map/search/mapSearchBar.store.ts`
- `Locava-Native/src/features/map/search/mapSearchSuggestionUtils.ts`

Key behavior in native:

- typing debounce + optimistic suggestion rendering
- grouping by suggestion type and mode (typing vs committed results)
- suggestion press routes to profile/map/results depending type
- map search handoff via map search store (`applySearchResult`)

---

## Old Backend V1 Files/Routes Involved

### Routes

- `POST /api/v1/product/search/suggest`
- `POST /api/v1/product/search/live`
- `POST /api/v1/product/search/bootstrap`
- `GET /api/public/search/autofill`
- `GET /api/public/search/resolve`
- `GET /api/public/search/posts`

Route/controller files:

- `Locava Backend/src/routes/v1/product/core.routes.ts`
- `Locava Backend/src/routes/search.routes.ts`
- `Locava Backend/src/routes/publicSearch.routes.ts`
- `Locava Backend/src/controllers/search.controller.ts`
- `Locava Backend/src/controllers/searchPublic.controller.ts`

### Services

- `Locava Backend/src/services/search/suggestions.service.ts`
- `Locava Backend/src/services/search/autofillLibrary.service.ts`
- `Locava Backend/src/services/search/autofillIntent.service.ts`
- `Locava Backend/src/services/search/autofillRanker.service.ts`
- `Locava Backend/src/services/search/searchIntent.service.ts`
- `Locava Backend/src/services/search/live/liveSearch.service.ts`
- `Locava Backend/src/services/search/searchExplorePosts.service.ts`

Old place dataset source:

- `Locava Backend/src/data/geonames-places.json`

---

## Current Backend V2 Files/Routes Involved

### Routes

- `GET /v2/search/suggest`
- `POST /v2/search/live`
- `GET /v2/search/bootstrap`
- `POST /v2/search/bootstrap` (wrapper)
- `GET /v2/search/results`
- compat bridges in `legacy-api-stubs.routes.ts`:
  - `/api/v1/product/search/suggest` -> `/v2/search/suggest`
  - `/api/v1/product/search/live` -> `/v2/search/live`
  - `/api/v1/product/search/bootstrap` -> `/v2/search/bootstrap`

### Route/contract/orchestration/service/repository files

- `src/routes/v2/search-discovery.routes.ts`
- `src/routes/v2/search-results.routes.ts`
- `src/contracts/surfaces/search-suggest.contract.ts`
- `src/contracts/surfaces/search-bootstrap.contract.ts`
- `src/contracts/surfaces/search-results.contract.ts`
- `src/orchestration/surfaces/search-results.orchestrator.ts`
- `src/services/surfaces/search-discovery.service.ts`
- `src/services/surfaces/search.service.ts`
- `src/repositories/surfaces/search.repository.ts`
- `src/repositories/source-of-truth/search-results-firestore.adapter.ts`

### V2 place index / startup warm

- `src/services/surfaces/search-places-index.service.ts`
- `src/app/createApp.ts` (`onReady` preload)
- local v2 dataset:
  - `Locava Backendv2/src/data/geonames-places.json`

---

## Current Native V2 Files Involved

- `Locava-Native/src/features/search/backendv2/searchV2.repository.ts`
- `Locava-Native/src/features/search/backendv2/searchV2.owner.ts`
- `Locava-Native/src/features/search/backendv2/searchV2.store.ts`
- `Locava-Native/src/features/search/backendv2/searchV2.types.ts`
- `Locava-Native/src/features/search/backendv2/searchV2.normalize.ts`
- `Locava-Native/src/features/search/SearchContent.heavy.tsx` (routing between legacy/v2 modes)

---

## Old vs Current Contract Comparison (Autofill)

## 1) Suggest

Old v1 request:

- `POST /api/v1/product/search/suggest`
- body:
  - `query: string`
  - `mode?: "social"`
  - `userContext?: { lat?: number; lng?: number }`

Old v1 response (effective):

- `success: boolean`
- `suggestions: Array<{ text; type; data?; suggestionType?; badge? }>`
- optional:
  - `detectedActivity`
  - `relatedActivities`
  - `responseTime`
  - `serverTimings`

Current v2 request:

- `GET /v2/search/suggest?q=<query>&lat=<lat>&lng=<lng>`

Current v2 response:

- envelope `{ ok, data, meta }`
- `data.routeName = "search.suggest.get"`
- `data.suggestions[]` with fields:
  - `text`, `type`, optional `suggestionType`, optional `badge`, `data`
- `data.detectedActivity`
- `data.relatedActivities`

### Parity status

- Path/method differs but compat bridge maps old POST to v2 GET.
- Suggestion row shape is near-compatible.
- Remaining gap fixed in this pass:
  - `"activity in <region>"` location-fragment matching.

## 2) Bootstrap

Old v1:

- `POST /api/v1/product/search/bootstrap` with query + optional geo context.
- returns posts for committed search + parsed summary.

Current v2:

- `GET /v2/search/bootstrap` (+ `POST` wrapper)
- returns:
  - `posts`
  - `rails`
  - `suggestedUsers`
  - `popularActivities`
  - `parsedSummary`

### Parity status

- Functional parity in purpose; payload richer in v2.
- compat bridge present for legacy clients.

## 3) Live typing

Old v1:

- `POST /api/v1/product/search/live`
- mixed categories from live search pipeline.

Current v2:

- `POST /v2/search/live`
- fanout to results/users/suggest; reduced duplicate mixed calls.

### Parity status

- Primary behavior equivalent for typing surfaces.
- Remaining differences in exact category composition/order still require final normalization pass.

---

## Old Ranking / Region / Fallback / Debounce Behavior

Old ranking/fallback patterns (v1):

- activity/place/user blended scoring via `autofillRanker.service.ts`
- parser + intent shaping (`autofillIntent.service.ts`, `searchIntent.service.ts`)
- fallback to user search Firestore prefixes on cache misses
- multiple cache layers:
  - short route cache
  - suggestions cache
  - live/bootstrap caches
  - in-flight dedupe maps

Debounce:

- mostly native-side debounce; backend optimizes with cache + in-flight dedupe.

Old region behavior:

- parser/intent recognizes `"in <location>"` and near-me semantics
- place suggestions and state/city synthesis in suggestions pipeline

---

## Current V2 Gaps Identified

1. `activity in <region>` handling was mismatched until fixed in this pass.
2. Some short partial `"in <prefix>"` ranking still needs polish to fully match old ordering.
3. `search.live` category parity is improved but not fully identical row-for-row to old v1 blend.
4. Some queries may still return empty collections/users when source data is sparse or query mismatch exists.
5. `search.results` still has known differences from old by-activities-smart semantics for certain natural-language/region-heavy queries.

---

## Fixes Implemented In This Pass

### Place dataset parity + preload

- Duplicated old GeoNames file into v2:
  - `src/data/geonames-places.json`
- Verified same hash as old file.
- Startup preloads in-memory index on `onReady`.
- Loader now prefers v2-local file path.

### Suggest performance + path hardening

- Added cache/in-flight checks before expensive work.
- Disabled legacy suggest bridge by default unless explicitly enabled via env.
- Added place-first and activity-fast paths to keep typing latency low.

### Suggest parity for `"activity in <region>"`

- Added extraction of location fragment after `" in "`.
- Place lookup now uses location fragment (not full query).
- Blocked fast activity short-circuit when query is location-phrase mode.
- Cleaned location phrase text construction:
  - `hiking in Vermont`
  - `hiking in Hartford`

### Search results posts restoration

- Added fallback post retrieval in `search.service.ts` when strict feed hydration fails.
- Enforced final `limit` on returned posts.

---

## Files Changed

- `src/services/surfaces/search-places-index.service.ts`
- `src/services/surfaces/search-discovery.service.ts`
- `src/app/createApp.ts`
- `src/routes/v2/search-discovery.routes.ts`
- `src/services/surfaces/search.service.ts`
- `src/orchestration/surfaces/search-results.orchestrator.ts`
- `src/data/geonames-places.json` (new local copy)
- `docs/autofill-v1-v2-parity-audit-2026-04-24.md` (this doc)

---

## Routes Changed

- `GET /v2/search/suggest`
- `GET /v2/search/bootstrap`
- `GET /v2/search/results`

Compat usage retained:

- `POST /api/v1/product/search/suggest`
- `POST /api/v1/product/search/live`
- `POST /api/v1/product/search/bootstrap`

---

## Verification Commands

Dataset parity:

- `ls -lh "Locava Backendv2/src/data/geonames-places.json"`
- `shasum -a 256 "Locava Backendv2/src/data/geonames-places.json"`
- `shasum -a 256 "Locava Backend/src/data/geonames-places.json"`

Suggest latency/parity quick checks:

- `curl -sS "http://127.0.0.1:8080/v2/search/suggest?q=boston" -H "x-viewer-id: <id>" -H "x-viewer-roles: internal"`
- `curl -sS "http://127.0.0.1:8080/v2/search/suggest?q=hiking%20in%20vermont&lat=42.33&lng=-71.11" -H "x-viewer-id: <id>" -H "x-viewer-roles: internal"`
- `tsx scripts/compare-search-suggest-parity.mts`

Results check:

- `curl -sS "http://127.0.0.1:8080/v2/search/results?q=hiking&limit=12&types=posts,collections,users,mixes" -H "x-viewer-id: <id>" -H "x-viewer-roles: internal"`

---

## What Was Broken

- v2 did not fully mirror old v1 location phrase behavior (`activity in <location>`).
- important suggestion categories were sometimes suppressed by overly aggressive fast paths.
- strict source-of-truth failures could zero out committed post results.
- v2 initially depended on old backend place-file path rather than local v2 copy.

## What V2 Now Does

- loads full old place corpus from local v2 file at startup.
- serves low-latency suggest responses with bounded work and dedupe.
- correctly resolves `"activity in <region>"` phrase suggestions.
- returns real post results for key activity/natural queries with fallback safety.

## Known Intentional Differences (current)

- v2 still uses explicit contracts/envelopes (`ok/data/meta`) instead of old raw response shape.
- some category ordering and blend edge cases remain to be fully normalized to old Sunday behavior.

## Manual QA Checklist

1. Open search modal on native.
2. Type:
   - `hiking`
   - `hiking in v`
   - `hiking in vermont`
   - `hiking in hartford`
   - `boston`
3. Confirm suggestion rows include expected place phrase completions.
4. Tap:
   - activity suggestion
   - place suggestion
   - user suggestion
5. Confirm correct navigation/handoff:
   - map handoff when applicable
   - committed results show posts and collections (when matching data exists).
6. Verify no fake/mix placeholder rows appear where old flow expected real entities.
