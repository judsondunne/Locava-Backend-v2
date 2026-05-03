## For You Ready Deck Fix (2026-05-03)

### Root cause
- Fresh no-cursor opens could repeat the same first 5 because `/v2/feed/for-you/simple` wrote served IDs through an async queue (`feed-seen-async-writer`) that is intentionally off-response-path and can lag or fail between app restarts.
- First page work was request-time heavy (multi-pass candidate scans + high filtered-by-seen churn), causing 100+ reads and unstable first-paint latency.

### Files changed
- `src/services/surfaces/feed-for-you-simple.service.ts`
- `src/repositories/surfaces/feed-for-you-simple.repository.ts`
- `src/routes/v2/feed-for-you-simple.routes.ts`
- `src/contracts/surfaces/feed-for-you-simple.contract.ts`
- `src/routes/debug/local-debug.routes.ts`
- `package.json`

### New architecture
- Added per-viewer in-memory ready deck (target ~30 cards) keyed by `viewerId + for_you_simple`.
- Added optional Firestore deck persistence (`feedDecks/{viewerId_surface}`) for warm handoff after instance churn.
- Added compact durable served-recent ledger (`feedServedRecent/{viewerId_surface}`) storing bounded `{postId, servedAtMs}` entries with TTL pruning.
- Serving flow now:
  - consume from deck first;
  - suppress served-recent/cursor duplicates;
  - synchronously persist served-recent on response;
  - refill deck on low watermark in background.

### Repeat-first-5 fix
- No-cursor request now gates on `servedRecent` (durable) before selecting deck items.
- Returned IDs are written to durable served-recent immediately in response flow.
- Emergency fallback also checks served-recent, blocked, own-post, and duplicate gates.

### Performance impact (expected)
- Warm: deck memory hit should avoid large candidate scans and collapse first-page read/query work to near-zero plus served/deck reads.
- Cold: bounded refill only, instead of repeated high-read no-cursor scans.
- First paint cards are feed-card-ready (`detailBatchRequiredForFirstPaint=false` in summary/debug).

### Remaining risks
- Cross-instance deck coherence still depends on Firestore deck freshness and cache TTL.
- If inventory is very small, repeats can still happen once served-recent window is exhausted/relaxed.
- Additional emulator/perf runs are needed to lock strict numeric budgets in CI for this branch.
