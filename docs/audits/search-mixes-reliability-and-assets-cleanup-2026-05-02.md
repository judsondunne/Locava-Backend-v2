# Search Mixes Reliability + Asset Cleanup (2026-05-02)

## 1) What was audited
- Backend routes/flows: `/v2/search/mixes/bootstrap`, `/v2/search/mixes/feed`, `/v2/search/mixes/:mixId/feed`, `/v2/search/results`, `/v2/search/suggest`, `/v2/search/bootstrap`, `/v2/mixes/:mixKey/preview`, `/v2/mixes/:mixKey/page`, `/v2/mixes/suggest`, `/v2/mixes/feed`, `/v2/mixes/area`.
- Native search/mix entrypoints audited: `SearchHomeSurface.tsx`, `searchHomeMixes.store.ts`, `backendv2/searchHomeMixes.api.ts`, `openSearchV2MixAsCollection.ts`, `autofillV2MixSuggestions.ts`, `searchMixIntentAdapter.ts`, `useSearchResultsMixFeed.ts`, `useSearchAutofill.ts`, `useSearchBootstrapPosts.ts`, `SearchContent.heavy.tsx`, `searchLiftableOpen.ts`.
- Native media adapters audited for carousel parity: `mixPostMedia.ts`, `postCanonical.ts`, `postEnvelope.ts`, `playbackPostModel.ts`, `AssetCarouselOnly.tsx`.

## 2) Current candidate/pagination behavior by route
- Canonical `/v2/search/mixes/*` already carries deterministic continuation and bounded staged expansion in nearby/location paths.
- Legacy `/v2/mixes/:mixKey/page` is still the primary native path for many search/mix flows; this path is where strict activity token matching and location-first ordering needed hardening.
- Native `useSearchResultsMixFeed.ts` keeps bounded radius expansion and dedupe by `postId`, and now remains aligned with backend ordering/cursor behavior for legacy mix pages.

## 3) Current asset normalization behavior by route/native adapter
- Backend mix DTOs may carry poster and legacy fields alongside `assets`, which is acceptable for compatibility but can cause duplicate carousel rows if native path normalization is loose.
- `mixPostMedia.ts` is the key adapter for search/mix preview/page media entering collection/open flows.
- Existing global playback sanitizer (`sanitizePostAssetsStripIosCameraRollDuplicates`) was present but not consistently leveraged by this adapter.

## 4) Confirmed causes of missing posts
- Activity matching in `/v2/mixes/*` over-relied on a narrower field set and could miss valid posts whose activity was stored under alternate shapes (`activityIds`, `tags`, `category`, `categories`, `primaryActivity`).
- Debug metadata did not expose enough stage counters to quickly tell whether drops were from activity mismatch vs missing geo.

## 5) Confirmed causes of duplicate poster/video carousel items
- Search/mix adapter normalization could accept duplicate poster-companion rows when payloads used `originalUrl`/`posterUrl` forms before canonicalization.
- Video asset `original` fallback could incorrectly resolve to poster URL in some paths, making poster metadata look like playable media.

## 6) Exact fixes made
- Backend (`src/services/mixes/mixes.service.ts`):
  - Expanded activity token extraction to include `primaryActivity`, `activityId`, `activityIds`, `tags`, `category`, `categories`, and object-shaped tags (`id`/`name`/`label`).
  - Added filtered-stage diagnostics computation (`candidateCountByStage`, `filteredOutByActivityCount`, `filteredOutByMissingGeoCount`) and surfaced it in debug payloads.
  - Preserved existing bounded in-memory behavior and deterministic distance-first sorting/cursoring for geo feeds.
- Native (`src/features/mixes/mixPostMedia.ts`):
  - Added pre-sanitize canonicalization of asset URL fields (`originalUrl` -> `original`, `posterUrl` -> `poster`/`thumbnail`) before dedupe.
  - Applied shared playback asset sanitizer in this adapter to collapse poster-companion and duplicate fallback rows before carousel mapping.
  - Prevented video `original` from falling back to poster URL (poster remains metadata only).

## 7) Tests added/updated
- Backend: `src/services/mixes/mixes.service.test.ts`
  - Added activity-shape completeness test (`activityIds`/`tags`/`category`).
  - Added geo pagination continuity test (distance-first page 1 and farther page 2).
- Native: `src/features/mixes/mixPostMedia.test.ts`
  - Added video-only modern asset canonical test (single carousel video row).
  - Added poster-companion dedupe test (no extra image row).

## 8) Performance/read-budget impact
- No unbounded reads were added.
- No route-level query fan-out was added.
- Activity completeness hardening remains in existing bounded pool filtering path.
- Native dedupe is in-memory and linear over current asset list size.

## 9) Remaining risks
- Legacy `/v2/mixes/*` depends on pool freshness; sparse pools can still produce lower completeness than source-of-truth query paths.
- Some search surfaces still span both canonical and legacy routes; semantics are closer but not fully unified under one backend path.
- Existing unrelated environment/firestore test failures outside these touched tests may still appear in full-suite runs.

## 10) Firestore indexes needed
- None for these changes.
- Changes intentionally stayed within current bounded/pool-based paths and existing query shapes.

---

## Final Verification Pass (2026-05-02)

### Real app paths verified (code trace)
- **Search home mix cards:** `SearchHomeSurface.tsx` → `openSearchV2MixAsCollection` / preview via `searchHomeMixes.store.ts` + `backendv2/searchHomeMixes.api.ts`. Initial collection hydration maps page rows through **`normalizeMixPostForCollection`** (`mix.card.media_summary`). Tapping a tile in search home uses **`openSearchExploreLiftable`** with the row as `basePost` where applicable (`SearchHomeSurface.tsx`), which merges through **`getMergedPostForLiftableOpen`** → `canonicalizePostRecord` + **`sanitizePostAssetsStripIosCameraRollDuplicates`** + `resolvePostMediaSource` — same sanitizer family as the mix adapter.
- **Autofill / results intent:** `autofillV2MixSuggestions.ts` and `searchMixIntentAdapter.ts` only build mix keys and filters; feeds still go through **`fetchV2MixPage`** / **`useSearchResultsMixFeed`** which normalizes rows with **`normalizeMixPostForCollection`** (`mix.page.item.media_summary`). No separate mix-id dialect was introduced in this pass.
- **Search results For You:** `useSearchResultsMixFeed.ts` → **`normalizeMixPostForCollection`** for list rows. **`SearchContent.heavy.tsx`** `onOpenPost` passes the full row as **`basePost`** into **`openSearchExploreLiftable`**, so list normalization is visible to the merge layer before the carousel.
- **Bootstrap grid:** `useSearchBootstrapPosts.ts` may supply lite rows; opens still go through **`openSearchExploreLiftable`** → canonical merge + sanitize. That path is intentionally richer on open; parity for video-heavy rows is covered by the **mix vs canonicalize+sanitize asset-count** test below.

### Search results vs mix feed — canonical media normalization
- **List rendering (For You / mix collection initial page):** both use **`normalizeMixPostForCollection`** (`useSearchResultsMixFeed.ts`, `openSearchV2MixAsCollection.ts`).
- **Liftable open:** **`openSearchExploreLiftable`** → **`normalizePostEnvelope`** over **`getMergedPostForLiftableOpen`**, which applies **`canonicalizePostRecord`** and **`sanitizePostAssetsStripIosCameraRollDuplicates`**. So the carousel is not a totally separate “rogue” normalizer; it stacks canonical + playback sanitize on top of whatever the list passed in.
- **Parity check:** targeted test asserts that for a representative modern video wire shape, **`normalizeMixPostForCollection`** and **`sanitizePostAssetsStripIosCameraRollDuplicates(canonicalizePostRecord(...))`** agree on **one** asset and the same **video** type (`mixPostMedia.test.ts`).

### Video-only posts — one carousel item
- Mix/search list path: sanitizer + video `original` rules in **`mixPostMedia.ts`** keep poster as metadata; tests cover legacy `photoLink` / `displayPhotoLink` alongside a single video asset (`mixPostMedia.test.ts`).
- Global playback dedupe remains validated in **`playbackPostModel.test.ts`** (poster companion collapse, etc.).

### Location / activity pagination — deterministic
- **`MixesService.page`** keeps **distance-first** ordering when `lat`/`lng`/`radiusKm` are set, with geo cursor **`mc:v2:`** continuation; verified by unit tests including **nearby two-page** and **activity + geo + alternate activity fields** with **no duplicate ids** across pages (`mixes.service.test.ts`).
- No new queries or index requirements were added in this cleanup.

### Remaining duplicate / split paths (by design)
- **Lite bootstrap grid** may open with thinner `basePost` than For You mix rows; **`getMergedPostForLiftableOpen`** then merges cache/detail. Asset *count* can differ until hydration completes, but duplicate poster slides from the same video payload are guarded by shared sanitizers.
- **Canonical `/v2/search/mixes/*` vs legacy `/v2/mixes/*`:** still two backend surfaces; native For You and home mixes remain on legacy **`/v2/mixes`** for speed. Behavior is aligned on intent IDs from prior work, not merged into one route in this pass.

### Tests run (this verification)
- Backend: `npx vitest run src/services/mixes/mixes.service.test.ts` — **pass** (13 tests).
- Native: `npx --yes tsx src/features/mixes/mixPostMedia.test.ts` — **pass**.
- Native: `npx --yes tsx src/features/media/playbackPostModel.test.ts` — **pass**.
- Native (attempted): `npx vitest run src/features/search/backendv2/searchV2.store.test.ts src/features/search/backendv2/searchV2Mixes.cache.test.ts` — **fails as Vitest suites** with “No test suite found”: these files are **tsx harness scripts** (they log `ok`), not Vitest `describe`/`it` tests. Run them with **`npx tsx <file>`** if needed, or convert later — **not a regression** from this cleanup.

### Small follow-up fix during verification (legacy photoLink)
- **`mixPostMedia.ts`** poster fallback now includes **`photoLink`** and **`legacy.photoLink`** so **photoLink-only** legacy rows still produce a **single** synthetic image asset when `assets` is empty (verified in `mixPostMedia.test.ts`). No UI or layout changes.

### Remaining risks (unchanged)
- Legacy mix pool completeness is still bounded by in-memory pool freshness.
- Full-suite / emulator tests may still fail for **unrelated** env reasons (Firestore test mode, payload limits, etc.); this pass did not expand full CI scope.

---

## Targeted Autofill Routing Fix (2026-05-02, follow-up)

### Exact bug
- In native search, tapping an autofill suggestion only committed plain text (`item.text`) and discarded suggestion intent metadata (`activity`, `locationText`, anchor lat/lng, source).
- That happened in `SearchContent.heavy.tsx` (`handleSuggestionTap` -> `commitToResults`), where the path previously passed only `q` into results mode.
- Result: downstream route selection had to re-infer intent from text and occasionally degraded to non-constrained behavior; logs in affected sessions showed generic `GET /v2/feed/for-you/simple?limit=5` traffic instead of constrained search/mix feed selection for the tapped intent.

### Targeted fix
- Added committed suggestion intent handoff from tap -> results feed:
  - `SearchContent.heavy.tsx` now stores the tapped suggestion payload (`text/type/data`) and passes it to `useSearchResultsMixFeed`.
- Hardened search mix intent planning:
  - `searchMixIntentAdapter.ts` now accepts an optional tapped-suggestion context and outputs:
    - `normalizedActivity`
    - `locationMode` (`none | near_me | fixed_place`)
    - `requiresViewerLocation`
    - `source` (`autofill | search`)
  - For `activity + near_me`, it now prefers the committed suggestion activity and preserves near-me intent.
  - For near-me without viewer coords, it sets `requiresViewerLocation` instead of silently degrading.
- Added defensive dev logs:
  - On tap: raw query, suggestion type, normalized activity, location mode, lat/lng presence, selected route/endpoint.
  - On fetch: selected route (`search_results.for_you_mix`) and endpoint (`/v2/mixes/:mixKey/page`) plus exact params.
  - On missing near-me coords: explicit `location_resolution_required` route log (no generic feed fallback).

### Behavior after fix
- Autofill taps like `"best hikes near me"` preserve intent through results feed selection and use search/mix feed routing (`/v2/mixes/:mixKey/page`) with constrained params.
- Near-me queries without coordinates now surface location-resolution requirement instead of silently switching to generic feed behavior.
- Home For You behavior remains unchanged; this fix is scoped to search/autofill tap routing only.

### Tests run for this follow-up
- Native harness: `npx --yes tsx src/features/search/searchAutofillRouting.contract.test.ts` — **pass**.
- Backend intent parser: `npx vitest run src/lib/search-query-intent.mixes-near-me.test.ts` — **pass** (updated with `"best hikes near me"` case).

---

## Live User Repro Fix — best hikes near me (2026-05-02, final hardening)

### Why the previous fix missed
- Prior fix hardened the **search mix planner** path (`useSearchResultsMixFeed`) but did not guard or instrument **all runtime `/v2/feed/for-you/simple` callsites**.
- During the repro flow, backend logs still showed repeated `/v2/feed/for-you/simple` calls because the home/feed owners could still request that endpoint while search was active, making logs ambiguous and masking the true route used by search results.

### Actual runtime callsite(s) still capable of calling `/v2/feed/for-you/simple`
- `Locava-Native/src/features/home/backendv2/feedV2.owner.ts`
  - `feedV2Owner.bootstrap` (home mount)
  - `feedV2Owner.paginate.first_page`
  - `feedV2Owner.paginate.retry_page`
- `Locava-Native/src/features/home/feeds/explorePosts.api.ts`
  - `fetchExplorePostsPage`

### Endpoint before vs after
- Before:
  - Search path was instrumented, but generic home endpoint remained callable in parallel without search-context guard.
  - Logs could still show `/v2/feed/for-you/simple` during search interactions.
- After:
  - Search-results planner continues to select `/v2/mixes/:mixKey/page` for constrained mix/feed intent.
  - Generic `/v2/feed/for-you/simple` now has a strict dev/test guard that **throws** when search context is active (`rawQuery`, `selectedSuggestion`, committed search intent, or search surface).
  - Every `/v2/feed/for-you/simple` callsite now emits callsite-tagged guard logs.

### How query/intent preservation now works
- `SearchContent.heavy.tsx` now:
  - stores selected suggestion context into a shared endpoint-guard store on tap
  - preserves committed suggestion intent into results feed input
  - registers keyboard-submit handler so submit path commits results intent (`commitToResults`) rather than silently bypassing results routing.
- `useSearchResultsMixFeed.ts` emits explicit fetch decision logs with:
  - `rawQuery`
  - `selectedSuggestion`
  - `committedIntent`
  - `normalizedActivity`
  - `locationMode`
  - `latLngPresent`
  - `selectedEndpoint`
  - `selectedParams`
  - `forbiddenGenericForYou`

### Logs to verify during repro
- Search results decision log:
  - `[search_results_fetch_decision]`
  - expected for repro:
    - `rawQuery: "best hikes near me"`
    - `normalizedActivity: "hiking"`
    - `locationMode: "near_me"`
    - `selectedEndpoint: "/v2/mixes/:mixKey/page"`
    - `forbiddenGenericForYou: false`
- Generic for-you callsite guard:
  - `[for_you_simple_callsite_guard]`
  - if search context is active, dev/test throws `for_you_simple_forbidden_in_search_context`.

### Files changed for this repro
- `Locava-Native/src/features/search/SearchContent.heavy.tsx`
- `Locava-Native/src/features/search/useSearchResultsMixFeed.ts`
- `Locava-Native/src/features/search/searchEndpointGuard.store.ts`
- `Locava-Native/src/features/home/backendv2/forYouSimpleGuard.ts`
- `Locava-Native/src/features/home/backendv2/feedV2.repository.ts`
- `Locava-Native/src/features/home/backendv2/feedV2.owner.ts`
- `Locava-Native/src/features/home/feeds/explorePosts.api.ts`
- `Locava-Native/src/features/search/searchResultsUserFlow.contract.test.ts`
- `Locava-Native/src/features/search/searchEndpointGuard.contract.test.ts`

### Tests added and run
- `npx --yes tsx src/features/search/searchAutofillRouting.contract.test.ts` — pass
- `npx --yes tsx src/features/search/searchResultsUserFlow.contract.test.ts` — pass
- `npx --yes tsx src/features/search/searchEndpointGuard.contract.test.ts` — pass
- `npx vitest run src/lib/search-query-intent.mixes-near-me.test.ts` — pass
- `npx vitest run src/services/mixes/mixes.service.test.ts` — pass

### Remaining risks
- The explicit repro path is now guarded against silent generic For You routing in dev/test, but final confirmation still requires device run with the expected logs above.
- Full backend audit still reports unrelated non-zero budget violations on some non-search surfaces (see `tmp/full-app-v2-audit-report.json`).
