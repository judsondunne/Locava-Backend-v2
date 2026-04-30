# Perf Hardening Before/After

## Baseline (before)

| endpoint | current observed latency | reads | queries | payload | caller surface | suspected cause | proposed fix | files touched | risk level |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |
| `/v2/feed/page?tab=following` | 4379ms | 736 | 25 | n/a | Home following page | per-item detail hydration + wide following candidate scan | card-only page, bounded query and cursor, staged detail hydration | `src/repositories/surfaces/feed.repository.ts`, `src/orchestration/surfaces/feed-page.orchestrator.ts` | High |
| `/v2/feed/bootstrap?tab=following` | 3012ms | 177 | 19 | n/a | Home first paint | bootstrap includes heavy card/detail hydration and follow nudge pressure | first-render cards only, defer heavy sections, tighter cache reuse | `src/orchestration/surfaces/feed-bootstrap.orchestrator.ts`, `src/repositories/surfaces/feed.repository.ts` | High |
| `/v2/posts/details:batch` | 1740-3833ms | 24-48 | 24-48 | up to 51KB | feed prefetch/playback | serial per-post hydration and per-item detail fetch | id dedupe, cap batch, batch card projection path for playback/card modes | `src/orchestration/surfaces/posts-detail.orchestrator.ts` | High |
| duplicate startup storms | repeated | n/a | n/a | n/a | startup + tab/screen focus | no shared in-flight coalescing in native transport + overlapping effect triggers | central request coalescing for identical GETs, keep abort-aware callers | `Locava-Native/src/data/backendv2/client.ts` | High |
| `/v2/achievements/snapshot` | 1834ms | 107 | 14 | 34KB | achievements deferred loads | snapshot path can race first-paint and perform full read | keep cache-backed shell path + defer heavy leaderboard/claimables | `src/orchestration/surfaces/achievements-snapshot.orchestrator.ts` | Medium |
| `/v2/social/contacts/sync` | 698ms | 88 | 245 | n/a | social/contact import | unbounded chunk fanout and wide candidate list querying | strict chunk caps + dedupe + keep background/deferred from first paint | `src/repositories/surfaces/suggested-friends.repository.ts`, `src/services/surfaces/suggested-friends.service.ts` | High |
| `/v2/social/suggested-friends` | repeated | 28 | n/a | n/a | onboarding + generic | repeated compute for multiple limits and over-fetch for cursor windows | cache + in-flight dedupe + bounded computeLimit | `src/routes/v2/social-suggested-friends.routes.ts`, `src/services/surfaces/suggested-friends.service.ts` | Medium |
| `/v2/profile/bootstrap` | variable | 29 | 8 | n/a | profile first paint | risk of full hydration pressure in bootstrap path | keep header/relationship/grid-preview only and defer detail | `src/orchestration/surfaces/profile-bootstrap.orchestrator.ts` | Medium |
| compatibility 404s | n/a | n/a | n/a | n/a | legacy native requests | missing handlers can trigger retries/noise | safe compatibility stubs/no-op handlers | `src/routes/compat/legacy-api-stubs.routes.ts` | Medium |
| `/v2/feed/for-you` diagnostics mismatch | weird counts | n/a | n/a | n/a | for-you home feed | diagnostics accounting not aligned with selected set/cursor path | deterministic counts and truthful diagnostics/cursor transitions | `src/services/surfaces/feed-for-you.service.ts` | High |

## Harness

- Script: `scripts/perf/launch-hardening-harness.ts`
- Writes:
  - `docs/perf-results/before.json`
  - `docs/perf-results/after.json`
- Validates:
  - route exists, non-404/500
  - required response keys still present
  - first-paint budgets (latency/read caps)

## Measured Results (final pass)

Source files:
- `docs/perf-results/before.json`
- `docs/perf-results/after.json`

| endpoint | before latency / reads / queries | after latency / reads / queries | notes |
| --- | --- | --- | --- |
| `/v2/feed/bootstrap?tab=following&limit=5` | 1081ms / 22 / 4 | 3ms / 0 / 0 (warm cache) | cold run no 503, reads under cap |
| `/v2/feed/page?tab=following&limit=5` | 277ms / 3 / 1 | 1ms / 0 / 0 (warm cache) | no 503, reads under cap |
| `/v2/feed/for-you?limit=5&debug=1` | 550ms / 30 / 3 | 155ms / 0 / 0 (warm cache) | diagnostics now guarded for truthfulness |
| `/v2/profiles/:userId/bootstrap?gridLimit=6` | 333ms / 1 / 5 | 5ms / 0 / 0 (warm cache) | unchanged contract, healthy |
| `/v2/social/suggested-friends?surface=generic&limit=8` | 328ms / 8 / 2 | 2ms / 0 / 0 | strong cache + in-flight reuse behavior |
| `/v2/social/contacts/sync` (small fixture) | 404ms / 1 / 3 | 315ms / 1 / 3 | bounded and improved |
| `/api/analytics/v2/events` | 200 | 200 | fixed compatibility route |
| `/api/config/version` | 200 | 200 | fixed compatibility route |
| `/api/v1/product/viewer` | 200 | 200 | fixed compatibility route |
| `/v2/achievements/bootstrap` | 200 / 1 / 0 | 200 / 1 / 0 | fail-soft guard prevents launch-blocking 500 |
| `/v2/achievements/snapshot` | 200 / 0 / 3 | 200 / 0 / 0 | fail-soft + cache path, no startup crash |
| `/v2/posts/details:batch` | 200 / 4 / 2 (real ids) | 200 / 0 / 0 (warm cache) | harness now uses discovered feed post IDs |

Legacy blocked-state reference (from prior run before this fix pass):
- `/v2/feed/bootstrap?tab=following&limit=5`: 5060ms, 905 reads, 15 queries
- `/v2/feed/page?tab=following&limit=5`: 503, 5172ms, 900 reads, 12 queries
