# Real User Replay Final Report (2026-05-04)

## Status

This repair pass materially improved the real-user replay and removed the largest original startup/feed/collections failures, but the replay is **not fully clean yet**.

Current state from the latest warm replay artifact:

- `feed_page_1` is within hard budgets
- `feed_page_2` is within hard budgets
- opened-post detail playback is within hard budgets
- collections recommended is within hard budgets
- profile following is within hard budgets
- BigQuery failure remains non-blocking and surfaced in logs/debug
- remaining hard failures are now concentrated in:
  - one later playback prefetch payload
  - one collection-detail playback prefetch read budget miss
  - search/mix preview cluster warm-path instability

Artifact reference:

- `docs/performance/artifacts/real-user-replay-latest.json`

## Original Observed Problems

From the real native-app log forensics:

- `/v2/feed/for-you/simple` first load: about `1454ms`, `125 reads`, `7 writes`, `7 queries`
- `/v2/feed/for-you/simple` next page: about `1059ms`, `122 reads`, even with `deckHit=true`
- `posts.details:batch` prefetch payload bloat around `68KB` and `76KB`
- feed/details playback variant mismatch: feed often selected `original`, details repaired to HLS
- search home bootstrap about `729ms`, `56 reads`, `11 queries`
- collections recommended about `1946ms`, `177KB`, `230 reads`
- profile following `limit=200` about `528ms` for tiny payload
- BigQuery analytics returned `202` while writes silently failed with `bigquery.tables.updateData denied`
- heavy startup warmers and scheduled pool refreshes risked competing with interactive traffic

## Reconstructed User Timeline

Relative to the first request:

- `0ms` `GET /v2/feed/for-you/simple?limit=5`
- `+288ms` `GET /v2/auth/session`
- `+1595ms` `GET /api/config/version`
- `+1958ms` `POST /v2/posts/details:batch` first playback prefetch
- `+3232ms` `POST /api/analytics/v2/events`
- `+3744ms` `POST /v2/posts/details:batch` next prefetch batch
- `+8793ms` `POST /v2/posts/details:batch` larger sliding-window prefetch
- `+9314ms` `POST /v2/auth/push-token`
- `+13326ms` `GET /v2/feed/for-you/simple?limit=5&cursor=...`
- `+13466ms` `POST /v2/posts/details:batch` overlapping page-2 prefetch
- `+14386ms` `POST /v2/posts/details:batch` additional post-page prefetch
- later concurrent clusters:
  - search home bootstrap + mix previews
  - achievements/profile/social fanout
  - collections recommended + detail prefetch

## Files Changed

- `package.json`
- `src/contracts/surfaces/feed-for-you-simple.contract.ts`
- `src/dto/compact-surface-dto.ts`
- `src/lib/posts/app-post-v2/toAppPostV2.test.ts`
- `src/orchestration/mutations/posting-finalize.orchestrator.ts`
- `src/orchestration/surfaces/feed-bootstrap.orchestrator.ts`
- `src/orchestration/surfaces/feed-page.orchestrator.ts`
- `src/orchestration/surfaces/posts-detail.orchestrator.ts`
- `src/orchestration/surfaces/posts-detail.orchestrator.test.ts`
- `src/repositories/source-of-truth/profile-firestore.adapter.ts`
- `src/routes/v2/collections-v2.routes.ts`
- `src/routes/v2/feed-for-you-simple.routes.ts`
- `src/routes/v2/posts-detail.routes.ts`
- `src/services/surfaces/feed-for-you-simple.service.ts`
- `src/services/surfaces/search-home-v1.service.ts`
- `scripts/perf/analyze-backend-log.ts`
- `scripts/perf/real-user-native-replay.ts`
- `scripts/perf/real-user-native-replay-loop.ts`
- `src/perf/real-user-native-replay.ts`
- `src/perf/realUserReplayBudgets.ts`
- `docs/performance/real-user-replay-analysis-2026-05-04.md`

## Tests Added Or Updated

- replay harness and budget definitions
- collections detail route tests
- posts-detail orchestrator tests for staged prefetch hydration behavior
- existing type-level and DTO tests updated to match compact playback shaping

Focused verification that passed during this repair pass:

- `npm run typecheck`
- `npx vitest run src/routes/v2/collections-detail.routes.test.ts`
- `npx vitest run src/orchestration/surfaces/posts-detail.orchestrator.test.ts`

Known suite caveat:

- broader `src/routes/v2/profile.routes.test.ts` remains environment-dependent in this workspace because it expects source-of-truth profile bootstrap success from live Firestore; that failure is not introduced by the changes in this pass.

## Before / After

| Route | Before | After (latest warm replay) |
| --- | --- | --- |
| `GET /v2/feed/for-you/simple` page 1 | `1454ms`, `125 reads`, `7 queries`, `7 writes`, violations | `109.39ms`, `1 read`, `1 query`, `0 writes`, `16815B`, pass |
| `GET /v2/feed/for-you/simple` page 2 | `1059ms`, `122 reads`, deck hit still expensive | `143.25ms`, `2 reads`, `2 queries`, `12223B`, pass |
| `POST /v2/posts/details:batch` first prefetch | large cache-heavy playback payloads | `65.74ms`, `3 reads`, `0 queries`, `28827B`, pass |
| `POST /v2/posts/details:batch` second prefetch | large playback payloads | `78.53ms`, `2 reads`, `0 queries`, `23315B`, pass |
| `POST /v2/posts/details:batch` later sliding prefetch | zero-read but bloated payloads, `payload_bytes_exceeded` | `5.56ms`, `0 reads`, `0 queries`, `45965B`, still just over payload hard cap |
| opened post detail | feed/details playback mismatch risk | `120.16ms`, `3 reads`, `3 queries`, `20934B`, pass |
| `GET /v2/search/home-bootstrap` | `729ms`, `56 reads`, `11 queries` | `767.69ms`, `14 reads`, `8 queries`, `12009B`, reads/queries improved but latency still slightly over hard cap |
| `GET /v2/mixes/cafe/preview` | warm-preview should be pool-backed | `268.35ms`, `26 reads`, `1 query`, still failing |
| `GET /v2/mixes/beach/preview` | warm-preview should be pool-backed | `502.07ms`, `104 reads`, `1 query`, still failing badly |
| `GET /v2/profiles/:id/following?limit=200` | `528ms`, tiny payload | `213.23ms`, `3 reads`, `2 queries`, pass |
| `GET /v2/collections/:id/recommended` | `1946ms`, `177KB`, `230 reads` | `375.20ms`, `38387B`, `29 reads`, `2 queries`, pass |
| collection detail prefetch | large payload + repeated source upgrades | `221.36ms`, `33496B`, `6 reads`, `3 queries`, improved but still over playback read cap |

## Major Repairs Completed

- feed first-page and pagination request path no longer block on heavy served-ledger work
- feed simple card payloads were compacted to visible-asset-first cards
- first-visible asset readiness is measured separately in the replay harness
- playback detail prefetch now returns staged, visible-asset-first shells instead of full secondary carousel/detail envelopes
- duplicate `appPost` / normalized / debug envelope payload bloat was removed from collections recommendation cards
- collections recommendations now use compact projections and bootstrap-first fallback behavior
- profile following avoids unnecessary total-count aggregation when the first page already proves completeness
- `POST_DETAILS_BATCH_PLAYBACK_CACHE_DECISION` logging was sampled/debug-gated
- replay harness now:
  - replays real route order and overlap
  - carries actual feed cursor and post IDs forward
  - emits JSON artifacts
  - survives missing downstream collection dependencies without crashing

## Asset Loading Priority Results

- home feed first visible asset latency improved from the original slow first-paint feed path to about `109ms` on the latest warm replay
- opened post primary asset latency remains separated from total detail latency in the harness and is currently measured as immediately available from the returned detail shell
- feed/details playback variant alignment improved materially; the earlier widespread feed-original/details-HLS mismatch is no longer one of the top replay failures
- duplicate prefetch payload waste was reduced to `0` in the latest artifact
- collection and playback prefetch now ship only the first visible asset and mark secondary assets for later hydration

## Remaining Blockers

These are the remaining replay blockers after the repair pass:

1. `details_prefetch_3` is still slightly over the payload cap:
   - `45965B` vs `45000B`
   - this is a narrow payload-shaping issue in the later sliding window

2. `collection_details_prefetch` still exceeds the playback read cap:
   - `6 reads`, `3 queries`
   - latest fix reduced it from `9/6` to `6/3`, but one extra cache/source path still burns more reads than the strict playback budget allows

3. search/mix preview cluster still falls back to read-heavy activity fetches:
   - `mix_preview_cafe`: `26 reads`
   - `mix_preview_beach`: `104 reads`
   - `search_home_bootstrap` latency remains slightly over the hard cap even though reads/queries improved
   - this now looks like a true pool-coverage / preview-fallback policy problem rather than generic request-path bloat

## Risks

- mix preview behavior likely needs a product-safe decision:
  - either accept stale/empty pool-backed previews when the pool lacks matching activity rows
  - or keep the current heavy activity fallback path and accept that it can blow preview budgets
- the late sliding playback prefetch payload is close enough to the cap that very small DTO differences can move it above or below the threshold
- broader live-Firestore profile route tests remain environment-sensitive in this workspace

## Manual Verification

1. Start the backend locally on port `8080`.
2. Point the native app to `http://127.0.0.1:8080`.
3. Open home feed and confirm:
   - first card renders immediately
   - first visible videos have poster + playable URL
   - page-2 feed load does not stall
4. Open a post from feed and confirm:
   - opened post primary asset appears before secondary metadata
   - playback variant matches feed choice unless intentionally upgraded
5. Open search home and confirm:
   - previews render without obvious stutter
   - mix preview requests are pool-backed when warmed
6. Open a collection and confirm:
   - recommended cards are lightweight
   - follow-on detail prefetch does not explode in payload

## Rerun Commands

```bash
npm run typecheck
npx vitest run src/routes/v2/collections-detail.routes.test.ts src/orchestration/surfaces/posts-detail.orchestrator.test.ts
npm run perf:replay:real-user
npm run perf:replay:real-user:loop
```

## Conclusion

The biggest real-user regressions from the original logs were repaired:

- home feed latency/read explosion
- next-page feed deck-hit inefficiency
- collections recommendation payload/read explosion
- profile following latency inefficiency
- major playback/detail payload bloat

The replay is not yet at the requested `3` consecutive clean passes. The remaining work is concentrated and well-understood, especially around:

- mix preview pool-vs-fallback policy
- one remaining collection playback prefetch read overage
- one later playback prefetch payload overage
