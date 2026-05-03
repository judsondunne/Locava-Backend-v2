# Search/Mixes End-to-End Audit (2026-05-02)

## 1) Executive summary

- Search/mixes behavior is split across **two backend families** and **multiple native intent builders**:
  - canonical-ish search mixes: `/v2/search/mixes/`* (SearchMixesServiceV2)
  - legacy/parallel mix preview/page: `/v2/mixes/`* (MixesService)
  - search results posts: `/v2/search/results` (SearchService/SearchRepository/SearchDiscoveryService)
- This split explains intermittent inconsistencies: mix cards/feed/query interpretation can diverge by surface.
- Confirmed concrete bug fixed: some generated location mix IDs used `location_activity:<label>:<activity>` while feed parsing expects `location_activity_state|city|place:`*; this could resolve to malformed queries and sparse/empty feeds.
- No broad architecture rewrite was made. Fixes were minimal and targeted to canonicalize generated location mix IDs.

## 2) Exact current routes/endpoints involved

### Backendv2 search/mix routes in active use

- `/v2/search/mixes/bootstrap` (`search.mixes.bootstrap.get`)
- `/v2/search/mixes/feed` and `/v2/search/mixes/:mixId/feed` (`search.mixes.feed.post/get`)
- `/v2/search/results` (`search.results.get`)
- `/v2/search/suggest` (`search.suggest.get`)
- `/v2/search/bootstrap` (`search.bootstrap.get`)

### Parallel/legacy-like routes still used by native search flows

- `/v2/mixes/:mixKey/preview` (`mixes.preview.get`)
- `/v2/mixes/:mixKey/page` (`mixes.page.get`)
- `/v2/mixes/suggest`
- `/v2/mixes/feed` (maps incoming mixSpec to search-mixes orchestrator with reduced intent)
- `/v2/mixes/area`

## 3) Exact native files involved

- `Locava-Native/src/features/search/SearchHomeSurface.tsx`
- `Locava-Native/src/features/search/searchHomeMixes.store.ts`
- `Locava-Native/src/features/search/backendv2/searchHomeMixes.api.ts`
- `Locava-Native/src/features/search/backendv2/openSearchV2MixAsCollection.ts`
- `Locava-Native/src/features/search/autofillV2MixSuggestions.ts`
- `Locava-Native/src/features/search/searchMixIntentAdapter.ts`
- `Locava-Native/src/features/search/useSearchResultsMixFeed.ts`
- `Locava-Native/src/features/search/useSearchAutofill.ts`
- `Locava-Native/src/features/search/useSearchBootstrapPosts.ts`
- `Locava-Native/src/features/search/SearchContent.heavy.tsx`
- `Locava-Native/src/features/search/searchResultsSurface.tsx`

## 4) Flow map

### A) Search bootstrap mixes (search page)

1. Native search home (`SearchHomeSurface`) builds mix definitions client-side via `searchHomeMixes.store` (`buildMixes`).
2. Preview cards are fetched via `fetchV2MixPreview` -> `/v2/mixes/:mixKey/preview`.
3. Opening a home mix uses `openSearchV2MixAsCollection`, first page via `/v2/mixes/:mixKey/page`, with client-side nearby radius retries.
4. This path does **not** consume `/v2/search/mixes/bootstrap` mix cards directly.

### B) Search autofill mix suggestions

1. Typing suggestions come from `/v2/search/suggest` via `useSearchAutofill`.
2. Native then builds additional v2 mix suggestions client-side in `autofillV2MixSuggestions.ts`.
3. Cover post probes for these suggestions are fetched from `/v2/mixes/:mixKey/preview`.
4. Opening suggestion mix collections often uses `/v2/mixes/:mixKey/page` (or `/v2/search/mixes/:mixId/feed` only in specific candidate paths with `mixSpecV1.v2MixId` present).

### C) Search results “For You” posts

1. Grid rows come from `useSearchBootstrapPosts` -> `/v2/search/bootstrap`.
2. Additional “For You mix feed” rows in v2 mode come from `useSearchResultsMixFeed` -> `/v2/mixes/:mixKey/page` with client-side radius expansion logic.
3. `searchV2Owner` (`/v2/search/results`) exists but is detached in the observed results-mixes-only path in `SearchContent.heavy.tsx`.

### D) Search results collections/mix sections

1. Collection rows are planned by `buildSearchResultsMixPlan` using autofill-derived intent.
2. Cover previews fetched via `/v2/mixes/:mixKey/preview`.
3. Opening collection mix uses `openSearchV2MixAsCollection` and `/v2/mixes/:mixKey/page` (plus special-case v2 mixId open path for some candidate rows).

### E) Mix detail/feed

- Canonical search mix feed is `/v2/search/mixes/:mixId/feed` (SearchMixesServiceV2).
- Home/autofill/results mix detail commonly use `/v2/mixes/:mixKey/page` instead.

## 5) Current mix intent shapes found in each path

- `searchMixes.contract` intent shape (`seedKind`, `activityFilters`, `locationConstraint`, etc.) for `/v2/search/mixes/`*.
- Native `SearchHomeMixDefinition` (`activity/state/place/lat/lng/radiusKm`).
- Native `AutofillV2MixSuggestion` (`type`, `activity/place/state/lat/lng/radiusKm`, id).
- MixSpec V1 carrier objects (`mix_spec_v1`, `v2MixId`, `heroQuery`, etc.).
- `/v2/mixes/`* filter shape (`activity/state/place/lat/lng/radiusKm`) with opaque `mixKey`.

## 6) Where paths agree

- All paths attempt to center around activity + optional location constraints.
- Both `/v2/search/mixes/`* and `/v2/mixes/`* implement bounded pagination and no unbounded client loops.
- Native consistently uses cached previews and avoids per-card N+1 waterfalls.

## 7) Where paths diverge

- Different backend services: `SearchMixesServiceV2` vs `MixesService`.
- Different intent IDs: canonical mixId strings vs client-generated IDs (`mix:`*, `nearby`, etc.).
- Different candidate pools:
  - search mixes v2 feed uses activity/daily/friends/nearby logic plus `SearchRepository` fallback for `location_activity`*
  - `/v2/mixes/`* uses pooled posts with local filter/sort logic
- Different expansion logic:
  - search mixes nearby expands ring stages server-side
  - native `/v2/mixes/page` nearby expands radius client-side
- Cover and preview generation can come from different logic than eventual feed depending on surface.

## 8) Confirmed bugs

1. **Generated explicit-location v2 mix IDs could be malformed**
  - Paths generated `location_activity:<label>:<activity>` while feed parser expects `location_activity_state|city|place:`*.
  - This can produce malformed location query construction and sparse/empty feed mismatches.
  - Fixed in:
    - `src/services/search-autofill/search-autofill.service.ts`
    - `src/services/surfaces/search-discovery.service.ts`

## 9) Suspected risks

- Native search home/results/autofill still rely heavily on `/v2/mixes/`*, so canonical `/v2/search/mixes/`* behavior is not the single source of truth.
- `SearchContent.heavy.tsx` currently detaches `searchV2Owner` in the active v2 mixes-only path, reducing consistency with `/v2/search/results` sections.
- Client-generated mix IDs and labels can still diverge from backend canonical intent unless unified further.

## 10) Performance/read-budget risks

- Current patterns are generally bounded, but maintaining two backends for similar surfaces duplicates reads/cache layers.
- Cover probing via preview endpoints is bounded and cached, but still doubles path complexity.
- No unbounded reads were introduced by fixes in this audit.

## 11) Recommended minimal fixes

Completed now:

- Canonicalized generated location mix IDs to `location_activity_city|state|place:*` where possible.

Recommended next minimal pass:

- Route native search results mix feed (`useSearchResultsMixFeed`) to `/v2/search/mixes/:mixId/feed` when a canonical mixId is available.
- Add optional debug metadata parity fields for mix cards/feed responses (`mixType`, `hasLatLng`, `radiusStagesAttempted`, `reasonIfEmpty`) in dev mode.
- Keep `/v2/mixes/*` for fallback only, not primary, to reduce divergence risk.

## 12) Tests/harnesses added or updated

- Updated:
  - `src/services/search-autofill/search-autofill.generated-mixes.test.ts`
    - accepted canonical location mix ID families now include `location_activity_place:`.

## 13) Before/after behavior

### Before

- Explicit-location generated mixes could emit `location_activity:<label>:<activity>` and feed resolution could misinterpret location intent.

### After

- Generated location mixes now emit canonical prefixes:
  - `location_activity_city:<cityRegionId>:<activity>`
  - `location_activity_state:<stateRegionId>:<activity>`
  - `location_activity_place:<displayLabel>:<activity>` fallback
- Autofill/bootstrap-generated location mix IDs now align with feed parser expectations.

## Core question answers

- One canonical mix intent shape? **No** (multiple shapes still active).
- Activity-only / nearby / activity-location fully consistent? **Partially**; intent families exist, but different services still implement them.
- Any endpoint returns cards without guaranteed hydrated previews/cover? **Yes** in some paths; native currently has fallback placeholders and stale-keep behavior.
- Cover art from same pool as feed? **Not guaranteed across all surfaces** due to `/v2/mixes/`* vs `/v2/search/mixes/`* split.
- Lat/lng guaranteed for near-me/activity-location? **Not universally**; depends on suggestion source and path.
- Place labels separate from coordinates? **Partially**, but can still be lossy between adapters.
- Radius expansion exists? **Yes** in both systems, but implemented differently.
- Deterministic pagination + dedupe? **Yes per-path**, but cross-path consistency differs.
- Hidden timeouts returning empty arrays? **Possible** in fallback/degraded branches (documented in repository/service fallbacks).

## Routes audited

- `/v2/search/mixes/bootstrap`
- `/v2/search/mixes/feed`
- `/v2/search/mixes/:mixId/feed`
- `/v2/search/results`
- `/v2/search/suggest`
- `/v2/search/bootstrap`
- `/v2/mixes/:mixKey/preview`
- `/v2/mixes/:mixKey/page`
- `/v2/mixes/suggest`
- `/v2/mixes/feed`
- `/v2/mixes/area`

## Remaining risks

- Primary native surfaces still use dual mix stacks.
- Canonical intent is improved for generated location mix IDs, but not yet enforced end-to-end on all native paths.

## Firestore indexes

- No new Firestore indexes were added by this audit/fix.
- Existing search/discovery queries still rely on current index set.