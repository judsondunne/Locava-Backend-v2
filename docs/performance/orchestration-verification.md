# BackendV2 Orchestration Verification

## Commands Run

- Baseline:
  - `npm test`
  - `npm run typecheck`
  - `npm run build`
- Targeted:
  - `npx vitest run src/observability/route-policies.test.ts src/routes/v2/posts-detail.routes.test.ts src/routes/v2/legends-events.routes.test.ts src/routes/v2/map-markers.routes.test.ts`
- Full reruns after implementation:
  - `npm test` (deterministic firestore harness)

## Results

- `npm run typecheck`: **fail** (pre-existing unrelated TS errors across repository; unchanged by this pass).
- `npm run build`: **fail** (same pre-existing TS errors).
- `src/observability/route-policies.test.ts`: **pass**
- `src/routes/v2/legends-events.routes.test.ts`: **pass**
- `src/routes/v2/map-markers.routes.test.ts`: **pass** under deterministic harness
- `src/routes/v2/posts-detail.routes.test.ts`: **pass** under deterministic harness after hydration-category assertion update
- `npm test` (latest run): **fail** with 2 unrelated regressions outside orchestration scope:
  - `src/services/mutations/posting-mutation.service.test.ts`
  - `src/services/posting/native-post-document.test.ts`

## Before/After Observations

- Before:
  - `posts.detail.batch` lacked explicit route policy entry and had no hydration mode.
  - contract governance could miss route names in multi-contract files.
  - legends unseen route could fail hard on missing index.
  - map marker payload default was broad/full.
  - request logs lacked Locava orchestration header metadata.
- After:
  - `posts.detail.batch` has explicit policy lane + mode-aware dedupe and staged hydration modes.
  - route governance catches all contract `routeName` declarations in file content.
  - legends missing-index path falls back gracefully.
  - map markers default to compact mode with explicit full opt-in.
  - request diagnostics and logs include orchestration metadata fields and lane-priority output.

## Blockers

- Missing `Locava-Native` repo in current workspace path prevented native orchestrator implementation and native tests.
- Full `npm test` still red due unrelated posting parity tests; these are outside files changed for orchestration.
