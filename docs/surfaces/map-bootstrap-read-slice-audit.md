# Map Bootstrap Read Slice Audit (Reconfirmation)

Date: 2026-04-20  
Scope: Reconfirm safe first map v2 slice before implementation.

## First-Render Map Data Required

Native first map render is marker-index driven. Required for initial draw:

- marker/post identity (`postId`)
- coordinates (`lat`, `lng`)
- lightweight marker visual hint (`thumbUrl` optional, media type)
- ordering recency marker (`ts`)
- optional activity/category keys for filter chips

No first-render dependency on full post detail, social counters, comments, weather, or broad user hydration.

## Marker Fields Required For Initial Render

Minimum safe `MapMarkerSummary`:

- `markerId` (same as post ID for now)
- `postId`
- `lat`
- `lng`
- `thumbUrl` (optional)
- `mediaType` (`image` | `video`)
- `ts`
- `activityIds` (string[])
- optional `settingType` (`indoor` | `outdoor`)

## Pressure Risks To Avoid

1. Geo/list/hydration overlap (index + social + detail in one request).
2. Fallback chain fan-out (`productBootstrap -> map/index -> posts`) causing cold-path variance.
3. Repeated map opens causing repeated cold index fetches.
4. Viewport/bounds churn creating high-cardinality request keys.
5. Marker detail overfetch in bootstrap path.

## What This Phase Must NOT Include

- marker detail hydration
- post card/detail payloads
- social/comment counters
- weather and external enrichment
- contact/directory blending
- broad user/author hydration

## Safety Bounds Required

- hard `limit` bound (small capped range)
- strict bbox validation and normalization
- bounded reads only against index-shaped data
- no multi-source fan-out in route handler
- short route cache TTL + in-flight dedupe + repo concurrency cap

## Slice Decision

Implement only:

- `GET /v2/map/bootstrap?bbox=minLng,minLat,maxLng,maxLat&limit=...`

returning marker-index-only payload with strict diagnostics and route budgets.
