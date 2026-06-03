# Undiscovered map layer architecture audit

Read-only audit for Backendv2 PBF copier, Firestore sources, map endpoints, and Locava-Native map consumer. No production Firestore mutations.

## PBF copier / admin

| Area | Location |
|------|----------|
| Admin UI | `src/dashboard/openstreetmap-pbf-copier.ts` |
| PBF parse/import | `src/admin/openstreetmap/national/pbfCopier/*` |
| Accept/write | `osmNationalWriter.service.ts`, `osmNationalDocBuilder.ts` |
| Tile cache writer | `osmNationalTileWriter.service.ts` (truncates `encodedPolyline` to 500 chars in tile items) |
| Hartland bbox | `pbfCopierGeoFilter.ts`, `INVENTORY_MVP_DEFAULT_VIEWPORT` in `inventoryBbox.ts` |

Filters include `publicMapEligible`, activity classification, route vs point geometry, OSM tags, and bbox viewport.

## Firestore collections

| Collection | Role |
|------------|------|
| `unexploredSpots` | Canonical point features (and occasional route-like spots) |
| `unexploredRoutes` | Canonical route features with `encodedPolyline` / geometry chunks |
| `unexploredTiles` | Partial viewport cache — **not** full source of truth |
| `posts` | Normal map markers only — not used for OSM undiscovered layer |

Hartland default bbox (read-only counts): ~111 public spots + ~2 public routes; tile docs hold only a handful of cached items vs full bbox query.

Route geometry: full polyline on route docs; tile items may truncate polyline for cache only.

## Current `/v2/map/markers` (problem)

- Merges unexplored only when `bbox` is present.
- Viewport bbox returns **partial** subsets vs full durable layer bbox — caused native shrink/disappear when merged.
- `payloadMode=compact` strips post DTOs but unexplored rows still carry large `routeSummary` / compatibility fields.
- Typical Hartland logs: ~117 spot reads, ~889 KB, ~3.3s.

## New `/v2/map/layers/undiscovered` (v1)

- Default **on** (`ENABLE_UNDISCOVERED_MAP_LAYER_V1` defaults true; set `false` to disable)
- Bbox durable layer: direct `unexploredSpots` + `unexploredRoutes` queries (no tile-first path).
- Canonical lightweight features + in-memory cache keyed by bbox/zoom.
- Log: `MAP_LAYER_UNDISCOVERED_V1_RESPONSE`

## Native consumer

| Piece | Location |
|-------|----------|
| Map owner / fetch | `backendv2/mapV2.owner.ts` |
| Store merge | `backendv2/mapV2.store.ts` `applyUndiscoveredLayer` |
| Route polylines | `mapUndiscoveredRoutePipeline.ts`, `MapSurface.tsx` |
| Layer v1 (flag) | `layer/undiscoveredMapLayer.*` |
| Native | Default **on** (`useUndiscoveredMapLayerV1()`; `EXPO_PUBLIC_USE_UNDISCOVERED_MAP_LAYER_V1=false` to disable) |
| Log | `UNDISCOVERED_MAP_LAYER_V1_ACTIVE` |

First paint: seed undiscovered disk cache when region known; v1 fetch does not clear on pan; partial responses must not shrink fuller layer.

## Count mismatches (why)

| Count | Meaning |
|-------|---------|
| PBF preview | Features passing dry-run filters in admin |
| Accepted/write | Docs written to Firestore |
| publicMapEligible | Eligible for map |
| Tile items | Subset cached per z/x/y |
| Native visible | Depends on bbox + merge policy + fetch path |

## Chosen v1 architecture

**Option B — bbox durable layer** first; contract and cache keys designed so **Option A** z/x/y tiles can be added without native rewrite.

## Scripts

- `npm run audit:osm:pbf:map-layer` — Firestore + normalizer audit
- `npm run audit:map-layer:endpoint` — HTTP harness vs Firestore

## Root causes (map feels wrong at mid/low zoom)

| Symptom | Root cause |
|---------|------------|
| Emoji marker flood | Layer v1 off by default → legacy `/v2/map/markers` bbox merge returns many point markers; native `filterPostsForUndiscoveredZoom` hid server clusters at regional zoom |
| Thick dotted route bands | `MKPolyline` / RN Maps stroke used 2–3.5pt up to `latitudeDelta` 0.35; many overlapping route polylines at once |
| Routes slightly off basemap | OSM geometry vs Apple/Google road geometry (expected); aggressive polyline downsampling at fetch time |
| One trail → many markers | PBF/classifier emits multiple route docs per relation fragment; fixed at read time via `mergeRouteFragmentFeatures` |
| Zoom out still dense | Undiscovered layer fetched once per bbox without zoom-bucket invalidation → server zoom filter frozen at first fetch zoom |

## Fixes in this pass (no Firestore writes)

- Server: route fragment merge, zoom-aware preview point caps, centralized stroke/dash constants
- Native: cluster visibility at regional zoom, zoom-bucket layer refetch, thinner route overlays (iOS + Android)
- Claiming: polyline-distance tests (unchanged radii)

Layer v1 is enabled by default (no .env required). To disable temporarily:

- Backend: `ENABLE_UNDISCOVERED_MAP_LAYER_V1=false`
- Native: `EXPO_PUBLIC_USE_UNDISCOVERED_MAP_LAYER_V1=false`

Dry-run Ludlow report: `npx tsx scripts/map/undiscoveredLudlowRegionReport.ts`

## Remaining toward tiles

- Precompute `mapTiles/{z}/{x}/{y}` or upgrade `unexploredTiles` with full feature payloads at accept time
- Admin map-layer preview step (point/route/geometry/payload estimates) with dry-run rebuild
- PBF accept path should write layer index when `ALLOW_MAP_LAYER_WRITE=true` (dry-run default)
