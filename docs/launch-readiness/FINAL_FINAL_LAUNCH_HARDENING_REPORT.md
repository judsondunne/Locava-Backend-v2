# Final Final Launch Hardening Report

## 1) Overall Status

**NOT SAFE TO LAUNCH**

- The live search repro hardening is implemented (search-context guard + endpoint-decision logs + flow tests).
- BigQuery write access is now verified.
- But the regenerated full-app audit still reports launch-surface budget failures (notably `search.results`, `map.bootstrap`, `notifications.list`, `posting.finalize`), so launch-critical FAIL-equivalents remain.

## 2) BigQuery

- Metadata check: **PASS**
- Real write test (`ANALYTICS_BIGQUERY_TEST_WRITE=1`): **PASS**
- Project/dataset/table: `learn-32d72.analytics_prod.client_events`
- Runtime credential source (local run): `google_application_credentials`
- Service account email surfaced by runtime script: `null` (not exposed by current ADC payload)
- Local vs deployed identity:
  - local: ADC via `GOOGLE_APPLICATION_CREDENTIALS`
  - Cloud Run identity not directly discoverable from this repo runtime config; treat as potentially different
- Non-blocking proof:
  - analytics ingest route contract/tests still return `202` independent of BigQuery publish outcome
  - publisher logs failures as non-blocking and rate-limited

## 3) Suggested Friends

- Final route policy/lane: `deferred_interactive` / `P3_DEFERRED_SCREEN`
- Cache TTL: 10 minutes
- Singleflight: enabled (`dedupeInFlight`)
- Groups source: optional/opt-in and failure-isolated
- Missing-index handling: dev logs now include Firestore message + index URL (when provided)
- Whether index is needed:
  - query remains `collectionGroup("members").where("userId","==",viewerId).limit(8)`
  - if index missing in target project, use:
```json
{
  "collectionGroup": "members",
  "queryScope": "COLLECTION_GROUP",
  "fields": [
    { "fieldPath": "userId", "order": "ASCENDING" },
    { "fieldPath": "__name__", "order": "ASCENDING" }
  ]
}
```
- App-open safety:
  - source failures are non-fatal
  - route is deferred
  - empty diagnostics response on aggregate failure instead of crash

## 4) Feed

- Old observed issue (from live logs): `/v2/feed/for-you/simple?limit=5` with ~340+ reads in search repro sessions.
- This pass focus:
  - added hard native guard preventing generic `/v2/feed/for-you/simple` when search context is active in dev/test
  - added callsite-tagged runtime logs to pinpoint all for-you simple callers
- Preserved:
  - cursor pagination behavior
  - duplicate filtering path in home owner
- Remaining:
  - no backend read-budget retune was applied in this pass; this report does not claim resolved feed read explosion on backend side.

## 5) Posts Details Batch

- Previous worst-case concern: payload/latency spikes (~108KB in prior logs).
- Current full-app audit row (`posts-detail-batch`): `PASS`.
- No route-contract payload redesign performed in this pass.
- Existing guardrail test coverage remains in backend route/orchestrator tests.

## 6) Collections Detail

- Previous audit issue: over budget.
- Current full-app audit row (`collections-detail`): `PASS`.
- No additional collection detail logic changes were needed in this pass.

## 7) Full App Audit

- Regenerated report: `Locava Backendv2/tmp/full-app-v2-audit-report.json`
- Counts:
  - `PASS`: 52
  - `PASS_WITH_STAGED_HYDRATION`: 4
  - `BROKEN_PAYLOAD_BUDGET`: 2
  - `BROKEN_LATENCY_BUDGET`: 4
  - `BROKEN_READ_BUDGET`: 1
- Remaining broken rows (examples):
  - `search.results.get` (`BROKEN_PAYLOAD_BUDGET`)
  - `map.bootstrap.get` (`BROKEN_PAYLOAD_BUDGET`)
  - `notifications.list.get` (`BROKEN_READ_BUDGET`)
  - `posting.finalize.post` (`BROKEN_LATENCY_BUDGET`)
  - `achievements.bootstrap.get` (`BROKEN_LATENCY_BUDGET`)
- Launch-critical routes therefore still include unresolved budget failures.

## 8) Changed Files (This Pass)

- `Locava-Native/src/features/search/searchEndpointGuard.store.ts`
  - Added shared runtime context store for query/suggestion/intent.
  - Impact: enables cross-feature guard logic.
  - QA: open search, type query, verify context-driven logs appear.
- `Locava-Native/src/features/home/backendv2/forYouSimpleGuard.ts`
  - Added strict dev/test guard against `/v2/feed/for-you/simple` in search context.
  - Impact: may throw in dev/test if wrong endpoint is selected.
  - QA: reproduce search flow and confirm no guard throw for valid mix endpoint.
- `Locava-Native/src/features/home/backendv2/feedV2.repository.ts`
  - Enforced guard before for-you request and added callsite logs.
  - Impact: blocks forbidden generic feed calls while search is active (dev/test).
  - QA: watch `[for_you_simple_callsite_guard]` logs for callsite + context.
- `Locava-Native/src/features/home/backendv2/feedV2.owner.ts`
  - Tagged bootstrap/paginate for-you callsites.
  - Impact: improves runtime traceability only.
  - QA: home open/scroll should emit callsite-tagged for-you logs.
- `Locava-Native/src/features/home/feeds/explorePosts.api.ts`
  - Tagged for-you callsite metadata.
  - Impact: improves runtime traceability only.
  - QA: explore feed fetch should report `fetchExplorePostsPage` callsite.
- `Locava-Native/src/features/search/SearchContent.heavy.tsx`
  - Wired search context updates, suggestion metadata retention, keyboard-submit commit path registration.
  - Impact: preserves intent across tap/submit; improves endpoint guard accuracy.
  - QA: type + submit and type + tap both transition to results with intent logs.
- `Locava-Native/src/features/search/useSearchResultsMixFeed.ts`
  - Added `[search_results_fetch_decision]` logs with endpoint/params and forbidden flag.
  - Impact: explicit runtime proof of selected endpoint.
  - QA: repro query should log `selectedEndpoint: /v2/mixes/:mixKey/page`.
- `Locava-Native/src/features/search/searchResultsUserFlow.contract.test.ts`
  - Added contract harness for submit/tap intent and constrained endpoint selection.
  - Impact: prevents regressions where search bypasses intent route.
  - QA: run tsx contract test.
- `Locava-Native/src/features/search/searchEndpointGuard.contract.test.ts`
  - Added contract harness for guard coverage and callsite instrumentation.
  - Impact: prevents silent guard removal.
  - QA: run tsx contract test.
- `Locava Backendv2/docs/audits/search-mixes-reliability-and-assets-cleanup-2026-05-02.md`
  - Added “Live User Repro Fix — best hikes near me” section.
  - Impact: documentation only.
  - QA: verify section reflects runtime path and expected logs.
- `Locava Backendv2/docs/launch-readiness/suggested-friends-index-and-analytics-audit.md`
  - Updated BigQuery status to include verified write pass.
  - Impact: documentation only.
  - QA: confirm real write command/result is recorded.

## 9) Tests Added/Changed

- `Locava-Native/src/features/search/searchResultsUserFlow.contract.test.ts`
  - Proves submit + committed intent path exists and search feed does not use generic for-you endpoint.
- `Locava-Native/src/features/search/searchEndpointGuard.contract.test.ts`
  - Proves dev/test guard exists and all known for-you callsites are instrumented.

## 10) Commands Run and Results

- `npx --yes tsx src/features/search/searchAutofillRouting.contract.test.ts` — pass
- `npx --yes tsx src/features/search/searchResultsUserFlow.contract.test.ts` — pass
- `npx --yes tsx src/features/search/searchEndpointGuard.contract.test.ts` — pass
- `npx vitest run src/lib/search-query-intent.mixes-near-me.test.ts` — pass
- `npx vitest run src/services/mixes/mixes.service.test.ts` — pass
- `ANALYTICS_BIGQUERY_TEST_WRITE=1 npm run debug:analytics:bigquery` — pass (test write succeeded)
- `npm run build` — pass
- `npm test -- --runInBand` — pass
- `npm run debug:full-app:v2-audit` — pass (report generated with remaining broken budget rows)

## Manual QA Checklist

- Sign in existing account
- Create account
- Open home feed
- Scroll first 3 pages
- Open several videos/photos
- Open map
- Change radius / explore markers
- Open search
- Type “best hikes near me” and a normal activity query
- Open mixes
- Open mix detail/post
- Open profile
- Open collection detail
- Open notifications
- Open chats
- Create photo post with EXIF
- Create video post without EXIF
- Create post with manual map location
- Verify address fallback
- Verify achievements/XP/leagues still appear
- Verify no blank cards, missing cover art, broken media, or repeated suggested-friends spam
- Verify analytics does not affect UI even if BigQuery fails
