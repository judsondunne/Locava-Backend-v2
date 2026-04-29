# BackendV2 Orchestration Audit

## Scope

- Audited surfaces/routes touched in this pass:
  - `posts.detail.batch`
  - `map.markers.get`
  - `legends.events.unseen.get`
  - global request observability hooks and route policy governance

## Findings and Fixes

- `posts.detail.batch`
  - Issue: no explicit policy lane, no hydration mode control, and no mode-aware dedupe key.
  - Fix: added explicit policy entry (`P1_NEXT_PLAYBACK`) in `route-policies`; added `hydrationMode` (`card|playback|open|full`) to contract and route; added mode-aware dedupe key `viewerId + postId + hydrationMode` in `PostsDetailOrchestrator`.
  - Priority lane: `P1_NEXT_PLAYBACK`.
  - Cancellation/dedupe: in-flight dedupe at orchestrator layer by mode key.
  - Remaining risk: no server-side cancellation token propagation yet (requires client orchestrator + abort semantics end-to-end).

- `map.markers.get`
  - Issue: default payload heavy for mobile parse/render.
  - Fix: added `payloadMode` query (`compact` default, `full` optional), compact payload strips non-essential marker fields.
  - Priority lane: currently inferred as `P2_CURRENT_SCREEN` from existing priority policy.
  - Cancellation/dedupe: existing route cache + global cache still in place; compact mode reduces payload bytes.
  - Remaining risk: no viewport/bounds filtering yet in this pass.

- `legends.events.unseen.get`
  - Issue: missing Firestore index can throw and surface 500.
  - Fix: catch missing-index/failed-precondition failure path; return graceful empty payload with poll delay + fallback marker.
  - Priority lane: inferred `P3_DEFERRED_SCREEN`.
  - Cancellation/dedupe: route remains lightweight and deferred-compatible.
  - Remaining risk: index deployment timing still matters for full fidelity.

- Request metadata + observability
  - Issue: request logs did not carry Locava orchestration headers and stale/cancel/dedupe-orientation fields.
  - Fix: request context now captures:
    - `x-locava-surface`
    - `x-locava-priority`
    - `x-locava-request-group`
    - `x-locava-visible-post-id`
    - `x-locava-screen-instance-id`
    - `x-locava-client-request-id`
    - `x-locava-hydration-mode`
  - Logs/diagnostics now emit lane-priority, surface/request-group/hydration metadata, and orchestration status fields (`stale|canceled|deduped|queueWaitMs`).
  - Remaining risk: stale/canceled flags are currently scaffolded defaults unless explicitly set by future request scheduler integration.

- Route policy coverage governance
  - Issue: route coverage test only captured first `routeName` match per contract file, allowing misses in multi-contract files.
  - Fix: switched to global regex `matchAll` for all `routeName` declarations; added explicit `posts.detail.batch` policy.
  - Remaining risk: none for quoted `routeName` declarations in current contract style.

## Legacy/Native Audit Status

- `Locava-Native` repository was not present under `/Users/judsondunne` in this workspace session, so native call-path migration/audit and client orchestrator implementation could not be executed in-code in this pass.
