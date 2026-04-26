# Home/Feed Bootstrap Discovery (Native + Legacy)

## Scope Reviewed

- Native home feed surface in `Locava-Native/src/features/home/reels/*`
- Native bootstrap/query flow in `Locava-Native/src/features/home/hooks/useReelsBootstrap.ts` and `src/data/repos/reelsRepo.ts`
- Legacy backend feed/reels controllers and services in `Locava Backend/src/controllers/reels.controller.ts`, `src/services/reels/reels.service.ts`, and `src/services/reels/forYouReels.service.ts`

## What Native Home Needs Immediately

The first paint path is poster-first feed cards. The initial API payload only needs enough to render the first viewport and allow immediate scroll:

- small first page of feed items (native currently runs page size `5` for recommendation/random paths)
- per-card minimal author identity
- poster URL and media type
- lightweight social counts and simple viewer flags
- deterministic item identity and ordering token

The native code then intentionally performs heavier work later (video startup, social hydration, full-post hydration), so bootstrap should stay lean.

## Exact First-Render Fields Needed

Per item, first render is satisfied by:

- `postId`
- minimal `author` (`userId`, `handle`, `name`, `pic`)
- `captionPreview` (short text only)
- minimal `media` (`type`, `posterUrl`, `aspectRatio`, startup hint)
- minimal `social` (`likeCount`, `commentCount`)
- minimal `viewer` flags (`liked`, `saved`)
- `updatedAtMs` and route-local rank token

## Deferred and Background Split

- **Deferred:** recommendation/session hints and non-blocking metadata (e.g., path health / stale guidance).
- **Background-only:** full post hydration, social batch hydration, next-page warming, video stream/mp4 source warmup, feed-seen batching.

## What Is Likely Overfetched / Slow Today

Observed risk areas in existing native + legacy path:

1. Legacy response shape includes much richer item payload than first paint strictly needs.
2. Follow-on full post hydration (`postRepo.getPost*`) can create extra call pressure if bootstrap is oversized.
3. Social hydration batches run after mount and can overlap with pagination if bootstrap returns too much.
4. Recommendation flow may perform large candidate/ranking work; if coupled to first response without strict limits it can stall first paint.
5. Duplicate in-flight bootstrap requests can occur during mount/remount unless deduped.

## Bog-Down Risk Pattern

Main bog-down pattern is not one endpoint alone; it is overlap:

- bootstrap request + recommendation work + social hydration + full-post hydration + media warmup in same window
- duplicate bootstrap calls during startup transitions
- payload growth that increases parse time and network transfer on weak connections

## Clean V2 Bootstrap Contract Recommendation

`GET /v2/feed/bootstrap` should:

- return only first-render feed-card summary items
- cap initial page to `5` default (`8` hard max)
- explicitly separate `firstRender`, `deferred`, and `background`
- keep all optional recommendation/session metadata in `deferred` with timeout/fallback
- avoid any full-post detail, comments tree, or heavy media fields in bootstrap

## What This Route Intentionally Refuses To Include

- full post detail objects
- comments/replies payloads
- heavy media URLs for multiple quality ladders
- neighboring post hydration slices
- mutation state trees not required for card render

## Payload Cap Strategy

- enforce strict bootstrap item cap (default 5, max 8)
- use lightweight card schema only
- route policy sets `targetBytes` and `maxBytes` budgets with diagnostics checks
- surface `payloadBytes` in `/diagnostics` for regression detection

## Media Startup Strategy Without API Bloat

- bootstrap returns poster-centric media hints only
- detailed stream selection and playback warmup stay out of bootstrap
- keeps API response fast and prevents media/API contention at first open
