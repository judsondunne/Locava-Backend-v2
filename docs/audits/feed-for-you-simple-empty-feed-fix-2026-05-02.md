# Feed For You Simple — empty-feed fix audit (2026-05-02)

## Root cause

Two interacting defects explained logs such as `returnedCount: 0`, `nextCursorPresent: false`, and ~500 Firestore reads while posts existed:

1. **Unbounded durable seen read** — `listRecentSeenPostIdsForViewer` could read **500** `feedSeen` documents per request (`DURABLE_SEEN_LIMIT`), dominating `dbReads` and masking healthy candidate throughput.

2. **Pagination stall when every raw document failed mapping** — Firestore returned batches (e.g. 30 docs), but after `mapDoc` filtering the **playable** list could be empty while `rawCount > 0`. The service advanced cursor state only when at least one candidate was accepted. With **no accepted candidates**, `lastValue` / `lastPostId` never advanced, so the phase burned attempts (`MAX_PHASE_ATTEMPTS`), exited with **non-exhausted** phases, and returned **`items.length === 0` with `nextCursor === null`** — the worst UX case.

Additionally, **strict durable-seen filtering** with no **relaxation/recycle** path could yield zero usable IDs even when the pool still contained playable posts.

## Fixes (behavior)

- **Bounded reads**: durable seen cap exported as `FOR_YOU_SIMPLE_SEEN_READ_CAP` (120) for this surface.
- **Tail pagination**: each batch exposes `tailRandomKey` / `tailDocId` from the last raw snapshot doc so the cursor advances even when every doc in the page is rejected during mapping.
- **Seen relaxation passes**: `strict` → `relax_durable_seen` (ignore durable ledger, still dedupe session/cursor) → `allow_all_seen` (only dedupe within this response chain).
- **Blocked authors & own-post exclusion**: `users/{viewerId}` blocked list + skip viewer-authored posts (counts in diagnostics).
- **Emergency fallback**: bounded slice ordered by `time desc` (fallback: `documentId desc`), max 25 raw docs, logged as `feed_for_you_simple_emergency_fallback_used` when the primary pipeline returns zero items.
- **Media**: mapping accepts degraded video/image when **original/native** URLs exist; asset normalization prefers originals when previews are missing.
- **Response contract**: top-level `exhausted`, `emptyReason`, `emergencyFallbackUsed`, flags for relaxed/wrap/fallback; cursor encoding bumped to **`fys:v2:`** (still decodes **`fys:v1:`**).
- **Query**: `limit` clamp **1–12** (default 5), optional **`refresh=true`** to ignore cursor.

## Diagnostics (`feed_for_you_simple_summary` log)

Extended structured fields include:

`rawReelCandidates`, `rawFallbackCandidates`, `filteredBySeen`, `filteredByBlockedAuthor`, `filteredByMissingMedia`, `filteredByInvalidContract`, `filteredByViewerOwnPost`, `filteredInvisible`, `filteredByCursorWindow` (reserved; 0 unless future cursor-window accounting), `relaxedSeenUsed`, `fallbackAllPostsUsed`, `wrapAroundUsed`, `emergencyFallbackUsed`, `degradedFallbackUsed`, `exhausted`, `emptyReason`, `mediaReadyCount`, `degradedMediaCount`, `missingMediaFilteredCount`, `dbReads`, `queryCount`, `elapsedMs`, plus existing anchor/cursor fields.

## Files changed

| Area | Path |
|------|------|
| Service | `src/services/surfaces/feed-for-you-simple.service.ts` |
| Repository | `src/repositories/surfaces/feed-for-you-simple.repository.ts` |
| Route | `src/routes/v2/feed-for-you-simple.routes.ts` |
| Contract | `src/contracts/surfaces/feed-for-you-simple.contract.ts` |
| Tests (emulator) | `src/routes/v2/feed-for-you-simple.routes.test.ts` |
| Native reference reducer | `src/services/surfaces/feed-for-you-simple.native-contract.ts`, `.native-contract.test.ts` |
| Debug script | `scripts/debug-feed-for-you-simple.mts` |
| NPM scripts | `package.json` (`test:feed.for-you.simple`, `debug:feed:for-you-simple`) |

## Tests

- **Deterministic (no emulator)**: `feed-for-you-simple.native-contract.test.ts` — Test G-style reducer behavior.
- **Emulator integration**: `npm run test:feed-for-you:simple:emulator` — includes updated recycle test, Tests B/C/E, performance read ceiling checks on seeded flows.

Single-command wrapper:

```bash
npm run test:feed.for-you.simple
```

## Manual verification

```bash
cd Locava Backendv2
npm run debug:feed:for-you-simple -- --viewerId=<viewerId> --limit=5
```

Full harness (seeds + three requests):

```bash
npm run debug:feed-for-you:simple
```

## Performance targets

- Warm path goal: **&lt;300ms**; cold **&lt;700ms** (environment-dependent).
- Seeded emulator checks assert **`meta.db.reads ≤ 100`** on representative happy paths.

## Native app

No in-repo React Native / Swift consumer was present under `Locava-Native` (only minimal stubs). Apply **`feed-for-you-simple.native-contract.ts`** semantics in the real client:

- Do **not** treat a zero-length page as terminal unless `emptyReason === "no_playable_posts"`.
- Do **not** show “all out” when `items.length < limit` unless product explicitly wants that for non-simple feeds.
- Optionally **`refresh=true`** once on transient empty.

## Remaining risks

- **`orderBy("time", "desc")`** emergency query requires a suitable Firestore index in production; failure falls back to `documentId` descending (less ideal ordering).
- **`filteredByCursorWindow`** is reserved at 0 until explicit accounting is added.
- **Pagination “append” reducer** for load-more is **not** specified in the reference module (only empty-state preservation).
