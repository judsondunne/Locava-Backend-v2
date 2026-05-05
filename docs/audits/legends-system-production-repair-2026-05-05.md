# Legends System Production Repair - 2026-05-05

## Executive summary
- Implemented a production hardening pass across backend and native for Legends with a strict **state/country-only** scope policy for new awards.
- Added centralized post eligibility policy (finalized + public + non-deleted + non-hidden), canonical scope builder usage, stronger stage-cancel ownership enforcement, and hardened after-post status semantics.
- Wired Legends tab badge presses to open the shared detail slider/modal pattern, and added delayed recovery polling on native so pending async processing is less likely to miss user-visible awards.

## Product rules implemented
- Location scopes for new awards are limited to `state` and `country`.
- New awards no longer include city/cell/locality scope derivations.
- Legends processing now uses one centralized post eligibility policy.
- After-post status contract now uses `pending | ready | none | error` and exposes UI-safe flags for award display.

## Files changed
- `src/domains/legends/legends.types.ts`
- `src/domains/legends/legend-scope-deriver.ts`
- `src/domains/legends/legend-post-eligibility.ts`
- `src/domains/legends/legend.service.ts`
- `src/domains/legends/legend.repository.ts`
- `src/routes/v2/legends-stage-post-cancel.routes.ts`
- `src/routes/v2/legends-after-post.routes.ts`
- `src/routes/v2/legends-me-bootstrap.routes.ts`
- `src/contracts/surfaces/legends-after-post.contract.ts`
- `src/orchestration/mutations/posting-finalize.orchestrator.ts`
- `src/domains/legends/legend-scope-deriver.test.ts`
- `src/domains/legends/legend-post-eligibility.test.ts`
- `src/domains/legends/legend.repository.cancel-stage.test.ts`
- `src/routes/v2/legends-after-post.routes.test.ts`
- `Locava-Native/src/features/legends/backendv2/legendsV2.repository.ts`
- `Locava-Native/src/features/legends/legendAwardsAfterPost.ts`
- `Locava-Native/src/features/post/upload/runPostUpload.ts`
- `Locava-Native/src/features/achievements/heavy/sections/LegendsSection.tsx`

## Canonical scope + eligibility behavior
- Canonical scope builder emits only:
  - `activity:*`
  - `place:state:*`
  - `place:country:*`
  - `placeActivity:state:*:*`
  - `placeActivity:country:*:*`
- Centralized eligibility (`legend-post-eligibility.ts`) rejects non-public, hidden, deleted, or non-finalized posts.

## After-post reliability semantics
- Response contract now includes:
  - `status`
  - `hasNewAwards`
  - `shouldShowAwardScreen`
  - `retryAfterMs`
  - `processedAt`
- Route returns only unseen + supported-scope awards and marks unseen awards as seen (best-effort) to prevent endless repeat popups.
- Native polling understands new statuses and does a delayed recovery pass if initial window ends in `pending`.

## Achievements Legends tab + badge detail
- Legends tab rows are now pressable and open the shared detail slider modal pattern (`LegendBadgeDetailModal`) with:
  - legend title/subtitle/type
  - rank/status context
  - competitor/top-user context via scope detail fetch

## Dual publish-path containment note
- Hardening concentrated on canonical legends processing data path and idempotent post-result status handling.
- Existing dual publish architecture remains; risk is reduced by idempotent processed-post records + consistent pending/ready/none/error semantics.

## Firestore collections touched
- `legendPostStages`
- `legendPostResults`
- `legendProcessedPosts`
- `users/{userId}/legendAwards`
- `users/{userId}/legends/state`
- `legendScopes`
- `legendUserStats`

## Legacy city/town/locality handling
- Legacy records are preserved.
- New scope derivation and new after-post/me-bootstrap legend surfaces filter to supported state/country-based scope keys for active/new award visibility.

## Tests added/updated
- Added:
  - `src/domains/legends/legend-post-eligibility.test.ts`
  - `src/domains/legends/legend.repository.cancel-stage.test.ts`
- Updated:
  - `src/domains/legends/legend-scope-deriver.test.ts`
  - `src/routes/v2/legends-after-post.routes.test.ts`

## Tests run
- `npx vitest run src/domains/legends/legend-scope-deriver.test.ts src/domains/legends/legend-post-eligibility.test.ts src/routes/v2/legends-after-post.routes.test.ts src/domains/legends/legend.repository.cancel-stage.test.ts`
- Result: all targeted tests passed.

## Remaining risks / follow-up
- Full emulator-wide deterministic suite has unrelated baseline failures in this workspace; targeted legends tests are green.
- A full production-grade TOP tie-policy metadata audit/migration for historical docs remains recommended for complete long-horizon determinism.
- Additional end-to-end native automation for post->award screen->legends tab->detail slider path is still recommended before release.

## Rerun commands
- Backend targeted: `npx vitest run src/domains/legends/legend-scope-deriver.test.ts src/domains/legends/legend-post-eligibility.test.ts src/routes/v2/legends-after-post.routes.test.ts src/domains/legends/legend.repository.cancel-stage.test.ts`

