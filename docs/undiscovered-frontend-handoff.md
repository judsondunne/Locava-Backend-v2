# Undiscovered Spots + Reels — Frontend Handoff (Aaron)

Verified against production `learn-32d72` on July 15. Everything below is live now.

## What's in Firestore

| Collection | Docs | Status |
|---|---|---|
| `unexploredSpots` | 17,656 | ✅ all have `mapTileKeys` |
| `unexploredRoutes` | 6,560 | ✅ all have `mapTileKeys` |
| `unexploredTiles` | 0 | tile cache not built yet — map layer falls back to `mapTileKeys` queries automatically, so nothing blocks rendering |
| `undiscoveredReels` | populating | schema below; written by the reels pipeline |

## 1. Spots + routes on the map

Don't read Firestore directly — use the backend endpoints:

- `GET /v2/map/layers/undiscovered` — the undiscovered layer for a viewport (reads tiles, falls back to `mapTileKeys` array-contains queries on spots/routes).
- `GET /v2/map/markers` — marker resolution.

Key fields on every spot/route doc (for rendering/filtering):

- `displayName`, `lat`, `lng` (routes also have geometry via `geometryChunks` subcollection)
- `category` / `categories` / `primaryActivity` — for pin icons
- `publicMapEligible: boolean` — only render when true
- `showAtZoom: number` + `displayPriority` — zoom gating so 17k pins don't render at once
- `stateCode: "VT"`

## 2. Photos ("where applicable, right when you open")

`POST /v2/undiscovered/photo-search`

```json
{ "collection": "unexploredSpots", "id": "unx_spot_...", "name": "Warren Falls", "town": "Warren", "state": "VT", "lat": 44.1, "long": -72.8 }
```

Response: `items[]` with `thumbnailUrl`, `imageUrl`, `sourceUrl`, `attributionText`, `disclaimer` (must be shown — these are web results Locava doesn't own), plus `cacheStatus`.

- Results are cached on the spot doc (`photoSearch` field), so repeat opens are free.
- **384 top spots are pre-warmed** (waterfalls, gorges, swimming holes first). The rest resolve on first tap — the endpoint searches, match-verifies, and caches in one call. Coverage grows as Serper quota allows (free-trial budget is the limiter; expanding).
- Render pattern: if the doc has `photoSearch.status === "ready"` show instantly; otherwise call the endpoint on detail-open and show a shimmer.

## 3. Instagram reels as undiscovered posts

Collection: `undiscoveredReels`. One doc per reel, id `reel_<shortcode>`:

```jsonc
{
  "id": "reel_Cx001",
  "kind": "undiscovered_reel",
  "region": "VT",
  "shortcode": "Cx001",
  "reelUrl": "https://www.instagram.com/reel/Cx001/",
  "caption": "…",
  "videoUrl": null,            // may be null — always have reelUrl to link out
  "thumbnailUrl": null,
  "creator": {                  // render attribution — this is the point
    "username": "vt_wanderer",
    "fullName": "…",
    "profilePicUrl": "…",
    "profileUrl": "https://www.instagram.com/vt_wanderer/"
  },
  "location": {
    "extractedName": "Warren Falls",
    "lat": 44.1, "lng": -72.8,
    "source": "spot_match",     // spot_match | geocode | ai_estimate | none
    "matchedSpotId": "unx_spot_…",   // when spot_match: link the reel to that spot's detail page
    "matchedSpotCollection": "unexploredSpots",
    "confidence": 0.9
  },
  "reviewStatus": "candidate"   // candidate | approved | rejected | published
}
```

Render rules:
- Pin reels at `location.lat/lng`; skip `source === "none"`.
- When `matchedSpotId` is set, also surface the reel on that spot's detail view.
- Always show creator username + link to `profileUrl` (attribution is required).
- Filter by `reviewStatus` if you only want curated ones; `candidate` is fine for the first push.

## Admin tooling (backend repo)

- `/admin/undiscovered/reels` — reels dashboard: paste collected reels or auto-fetch by spot name, preview matches, write to `undiscoveredReels`.
- `scripts/read-only-count-undiscovered-collections.mts` — live counts.
- `scripts/backfill-unexplored-spot-tiles.mts` — builds the `unexploredTiles` cache (dry-run by default, `--apply` to write). Optional perf/cost win, not required for rendering.
