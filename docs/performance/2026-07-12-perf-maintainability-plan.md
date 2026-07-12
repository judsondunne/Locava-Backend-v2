# Backend v2 Perf + Maintainability Plan (2026-07-12)

Branch: `cursor/perf-maintainability-hardening-df59`

Goal: improve general performance, loading time, and maintainability without breaking native contracts or production Firestore safety.

## Guardrails (non-negotiable)

- No destructive Firestore scripts against production
- Preserve existing `/v2/*` response envelopes and Zod contracts
- Prefer additive fields / internal efficiency over shape changes
- Prove each change with unit/contract/audit tests before stacking the next
- If a change requires native coordination, keep backend backward-compatible first

## Phase A — Quick wins (low risk, high confidence)

| ID | Change | Why | Risk | Proof |
|----|--------|-----|------|-------|
| A1 | Use Firestore `getAll` chunking in `render-standardized-batch` | Fewer round trips when native opens profile grid / batch hydrates posts | Low | existing batch handler tests + unit test for chunking |
| A2 | Ensure profile bootstrap counts land in `firstRender` | Native can show 0 followers on first paint when counts are deferred | Low–Med | profile bootstrap contract/orchestrator tests |
| A3 | Align comments bootstrap `countHint` with returned rows | Native logs contractMismatch / empty sheet with nonzero badge | Low | comments bootstrap tests |
| A4 | Confirm mixes pool env defaults match read-reduction plan | Avoid unnecessary cold reads on search home | Low | env defaults + mixes repository unit tests |

Out of scope for A (infra, not pure code): CDN / Wasabi cache headers / sized thumbnail generation — document as follow-up if no in-repo lever exists.

## Phase B — Broader safe improvements (no breaking changes)

| ID | Change | Why | Risk | Proof |
|----|--------|-----|------|-------|
| B1 | Enrich `/v2/feed/for-you/simple` card payload with already-available playback-ready media fields | Reduce native two-hop `details:batch` dependency | Med | feed-for-you-simple contract + replay/perf audits |
| B2 | Improve `posts/details:batch` efficiency for larger ID sets (without forcing native limit changes) | Support native raising prefetch from 3→8–16 later | Low–Med | posts-detail orchestrator tests |
| B3 | Trim search-home-bootstrap read fanout where safe (cache reuse, shared mixes pool) | Lower cold search home latency (~14 reads today) | Med | search-home tests + read budget policy |

Deferred (not this branch unless trivial and proven safe):

- Following feed cursor/deck migration (high invasiveness)
- God-file splits of 2k–3k line modules (separate maintainability PRs)
- Redis coherence rollout (ops + env)
- Legacy `for-you` path retirement (needs native confirmation)

## Execution order

1. Implement A1 → test → commit
2. Implement A2 → test → commit
3. Implement A3 → test → commit
4. Verify A4 (code change only if defaults diverge) → commit if needed
5. Implement B1 (additive only) → test → commit
6. Implement B2 → test → commit
7. Implement B3 (only if clear win without contract break) → test → commit
8. Push branch + open PR with evidence

## Success criteria

- Existing contract tests pass
- No new route policy budget regressions on changed surfaces (or intentional documented improvements)
- Response shapes remain backward-compatible for Locava-Native
- Each commit is independently revertible


## Status (2026-07-12)

Phase A + Phase B implemented on `cursor/perf-maintainability-hardening-df59`.

Proven with vitest:
- render-standardized-batch getAll chunking
- profile bootstrap postsCount aliases
- comments countHint clamp
- feed card instantPlaybackReady / posterPresent
- posts-detail LOCAVA_BATCH_PLAYBACK_MAX_ITEMS
- search-home skip empty firstPost probes

Deferred (not in this branch): CDN/media infra, Following cursor migration, god-file splits, Redis coherence.


### Phase C (continued)

| ID | Change | Proof |
|----|--------|-------|
| C1 | Fix search-home cache key to `search:home:v1:{viewerId}` + cold-build dedupe | `search-home-v1.cache-key.test.ts` |
| C2 | Parallel mix bootstrap with suggested friends | `search-home-v1.service.test.ts` parallel test |
| C3 | Optional playback readiness fields on `PostCardSummarySchema` | `post-entities.contract.test.ts` |
| C4 | Field mask on search-home user `getAll` | `search-home-v1-users.repository.test.ts` |
| C5 | Parallel blockedUsers + posts getAll; mask `blockedUsers` | `render-standardized-batch.handler.test.ts` |
