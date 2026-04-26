# Map Bootstrap Surface (v2 Lean Read Slice)

Date: 2026-04-20  
Scope: marker-index-only map bootstrap.

## Implemented Route

- `GET /v2/map/bootstrap?bbox=minLng,minLat,maxLng,maxLat&limit=...`

## Exact Safe First Slice

Returns only marker index rows (`MapMarkerSummary`) for initial map render:

- `markerId`, `postId`
- `lat`, `lng`
- `thumbUrl` (nullable)
- `mediaType`
- `ts`
- `activityIds`
- `settingType` (nullable)

No detail/post/social enrichment is included.

## Source Strategy

- bounded index query path only
- strict bbox parsing/validation
- hard limit bounds (`20..300`)
- no broad scans outside pre-shaped marker corpus
- no mixed list/detail hydration in route path

## Pressure Strategy

- route cache (short TTL)
- in-flight dedupe by `(bbox, limit)`
- repository concurrency cap
- strict route policy budgets
- diagnostics-visible cache/dedupe/concurrency/budget behavior

## Route Policy

`map.bootstrap.get`:

- priority: `critical_interactive`
- latency: `p50 90ms`, `p95 210ms`
- dbOps: `maxReadsCold 300`, `maxQueriesCold 1`
- payload: `target 90KB`, `max 180KB`
- cache expectation: `required`
- concurrency expectation: dedupe true, max repo ops 8

## Intentionally Not Implemented

- marker detail hydration
- post card/detail payloads
- social/comment counters
- weather overlays
- contact/directory blending
- author/user profile hydration

## Diagnostics Verification Targets

Verify in `/diagnostics`:

- `routeName = map.bootstrap.get`
- `routePolicy` attached
- `payloadBytes`, `dbOps`, `cache`, `dedupe`, `concurrency`
- `fallbacks/timeouts` visibility
- `budgetViolations` empty for normal requests

## Tradeoffs

- Marker payload is intentionally minimal and may require future follow-up route(s) for richer interactions.
- Strict bounding avoids storms but can return fewer markers than the legacy heavy path in broad geographies.
