# Search Home Bootstrap Audit Note

## Replaced / Quarantined

- Canonical endpoint is now **`GET /v2/search/home-bootstrap`** (v1). Legacy `GET /v2/search/home/bootstrap` was removed.
- Removed Search Home dependence on legacy bridging paths by isolating home bootstrap assembly to dedicated V2 route/orchestrator/service.
- Stopped route-level business assembly in Search routes by moving new logic into orchestrator/service layers.
- Replaced unstable home mix selection behavior with deterministic day-keyed assembly through V2 mix service output.

## Current Compatibility Notes

- Existing `GET/POST /v2/search/bootstrap` and `/v2/search/mixes/*` remain for typed search and mix feeds; Search Home should consume the new canonical home endpoint.
- Legacy compat proxy routes remain in compat modules and are not used by `search.home.bootstrap`.

## Reliability Changes

- Added two-layer cache keys:
  - `searchHome:global:YYYY-MM-DD` (18h TTL)
  - `searchHome:viewer:{viewerId}:YYYY-MM-DD` (10m TTL)
- Added stale-serving window for fast first paint.
- Added route policy for `search.home.bootstrap` with explicit latency/read/payload budgets.
- Added diagnostics block in payload (`latencyMs`, `readCount`, `payloadBytes`, returned sections).
