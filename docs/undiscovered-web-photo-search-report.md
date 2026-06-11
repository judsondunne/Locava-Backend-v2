# Undiscovered Web Photo Search — Implementation Report

Date: 2026-06-07

## Summary

On-demand, cached web photo search for undiscovered spots/routes. Uses the existing PBF heuristic pipeline (Serper/Bing + metadata scoring). **No Gemini.** Photos stay hidden until the user taps "See web photos."

## Route added

- `POST /v2/undiscovered/photo-search`
- Route name: `undiscovered.photo_search.post`

## Files changed

### Backend (`Locava Backendv2/`)

| File | Purpose |
|------|---------|
| `src/contracts/surfaces/undiscovered-photo-search.contract.ts` | Request/response/cache Zod schemas |
| `src/lib/undiscovered/unexploredDocToPbfPreviewDoc.ts` | Firestore doc → `PbfCopierPreviewDoc` adapter |
| `src/lib/undiscovered/undiscoveredPhotoSearchMapper.ts` | Asset preview → `photoSearch` cache mapper |
| `src/lib/undiscovered/undiscoveredPhotoSearchBudget.ts` | Viewer + global provider rate limits |
| `src/services/undiscovered/undiscoveredPhotoSearch.service.ts` | `searchPlaceWebImagesForUndiscovered` orchestration |
| `src/repositories/source-of-truth/unexplored-photo-search-firestore.adapter.ts` | Partial Firestore writes (`photoSearch` only) |
| `src/routes/v2/undiscovered-photo-search.routes.ts` | HTTP route |
| `src/app/createApp.ts` | Route registration |
| `src/routes/v2/post-like-item-detail.routes.ts` | Pass-through `photoSearch` on detail item |
| `src/services/undiscovered/undiscoveredPhotoSearch.service.test.ts` | Unit tests |
| `.env.example` | Feature env vars documented |

### Native (`Locava-Native/`)

| File | Purpose |
|------|---------|
| `src/postLike/undiscoveredPhotoSearch.types.ts` | Typed cache/response models |
| `src/postLike/fetchUndiscoveredPhotoSearch.ts` | `POST /v2/undiscovered/photo-search` helper |
| `src/postLike/ui/undiscoveredWebPhotos/UndiscoveredPhotoRevealPrompt.tsx` | Surprise vs reveal choices |
| `src/postLike/ui/undiscoveredWebPhotos/UndiscoveredWebPhotoCard.tsx` | Card + source sheet |
| `src/postLike/ui/undiscoveredWebPhotos/UndiscoveredWebPhotoCarousel.tsx` | Horizontal carousel (max 5) |
| `src/postLike/ui/undiscoveredWebPhotos/UndiscoveredWebPhotoRevealModule.tsx` | State machine + fetch orchestration |
| `src/features/liftable/AssetCarouselOnly.tsx` | Integration on undiscovered hero path |

## Cache schema (`photoSearch` on `unexploredSpots` / `unexploredRoutes`)

```json
{
  "schema": "locava.undiscoveredPhotoSearch",
  "version": 1,
  "status": "ready | empty | failed | refreshing",
  "query": "string",
  "provider": "serper | bing | mock | none",
  "validator": "none",
  "fetchedAt": "ISO timestamp",
  "expiresAt": "ISO timestamp",
  "resultCount": 0,
  "results": [{ "thumbnailUrl", "sourceUrl", "sourceDomain", "attributionText", "disclaimer", ... }],
  "error": null
}
```

- Stores up to **12** accepted results; API returns **5**
- Remote URLs only — no image binaries, no Wasabi/Storage uploads
- Source of truth: canonical unexplored doc (not tile docs)

## Pipeline reused (heuristic only)

1. `buildOsmSpecificPhotoQuery`
2. `searchPlaceImages` (Serper → Bing)
3. `finalizePlaceImageResults` filters (maps, logos, embeds, loadability)
4. `scorePhotoSearchResultsForPlace` metadata consensus
5. `processPbfAssetPreviewSpot(..., { visionMode: "off" })` — **never Gemini**

## Env vars

| Variable | Default | Purpose |
|----------|---------|---------|
| `SERPER_API_KEY` | — | Primary image search |
| `BING_SEARCH_API_KEY` | — | Fallback image search |
| `UNDISCOVERED_PHOTO_SEARCH_ENABLED` | `true` | Feature flag |
| `UNDISCOVERED_PHOTO_SEARCH_CACHE_TTL_DAYS` | `30` | Cache TTL |
| `UNDISCOVERED_PHOTO_SEARCH_MAX_PER_MINUTE_PER_VIEWER` | `10` | Per-viewer rate limit |
| `UNDISCOVERED_PHOTO_SEARCH_MAX_PROVIDER_CALLS_PER_DAY` | `500` | Global daily provider cap |

## Test commands

```bash
cd "Locava Backendv2"
npx vitest run src/services/undiscovered/undiscoveredPhotoSearch.service.test.ts
```

## Manual QA checklist

1. Open an undiscovered spot/route in liftable view — hero shows, **no web photos visible**
2. Prompt shows "Keep it a surprise" and "See web photos"
3. Tap "Keep it a surprise" — prompt dismisses, hero unchanged
4. Tap "See web photos" — loading text, then carousel or empty mystery message
5. Second user / repeat tap on cached spot — instant carousel (cache hit)
6. Each carousel card shows `Web result · {domain}` overlay + info button
7. Info button opens sheet with disclaimer + "Open source"
8. Failed/empty search shows mystery message, not broken images
9. Claim/posting flows unchanged
10. Photos never appear without explicit user tap

## JS-only verification

After backend is running and Metro is up:

```bash
curl -X POST http://127.0.0.1:8080/v2/undiscovered/photo-search \
  -H 'Content-Type: application/json' \
  -H 'x-viewer-id: qa-viewer' \
  -d '{"collection":"unexploredSpots","id":"<known-spot-id>"}'
```

Reload native app after JS changes: `curl -X POST http://127.0.0.1:8081/reload`
