# Feed Page Discovery (Native + Legacy)

## Scope Reviewed

- Native feed scrolling and pagination behavior in `Locava-Native/src/features/home/reels/ReelsFeedHeavy.tsx`
- Native query pagination behavior in `Locava-Native/src/features/home/hooks/useReelsBootstrap.ts`
- Native repo request shaping in `Locava-Native/src/data/repos/reelsRepo.ts`
- Native feed item contract in `Locava-Native/src/features/home/reels.types.ts`
- Legacy backend pagination in `Locava Backend/src/controllers/reels.controller.ts` and `src/services/reels/reels.service.ts`

## What the Feed Page Route Needs

For continuation pages, native feed still needs the same lightweight card shape used at bootstrap.  
No extra detail payload is required to keep scrolling smooth.

Required page item fields:

- `postId`
- minimal `author` summary
- `captionPreview`
- minimal `media` (`type`, `posterUrl`, `aspectRatio`, startup hint)
- minimal `social` summary
- minimal `viewer` flags
- `updatedAtMs`
- rank/session token for stable reconciliation

## Bootstrap vs Page Item Shape

Recommendation: keep item shape effectively identical to bootstrap.

Reason:

- avoids client transform branches
- limits accidental payload growth
- prevents page route from becoming hidden detail hydration

## Likely Old Pressure Sources

1. Page requests overlapping with post hydration and social hydration work.
2. Duplicate same-cursor requests during fast scroll or remount windows.
3. Cursor progression not strictly bounded can increase candidate/ranking pressure.
4. Returning richer-than-needed item payload inflates transfer and parse cost.
5. Bootstrap + next-page prefetch overlap can create request spikes if not deduped/capped.

## Safe Page Size

Based on current native behavior (5 bootstrap items, incremental fetching while nearing list tail):

- default page limit should remain `5`
- maximum should be capped at `8`

This keeps memory/network pressure low while allowing smooth scroll continuity.

## Duplicate / Overlap / Out-of-Order Behavior

Likely duplicate points:

- same cursor requested twice during fast state transitions
- rapid scroll causing adjacent cursor requests to overlap

Server-side strategy:

- dedupe in-flight for identical `(viewer, cursor, limit)` key
- concurrency cap for repository page reads
- cache page slices by `(viewer, cursor, limit)` to absorb weak-network retries
- include `cursorIn` and `requestKey` in response so client can ignore stale/out-of-order responses

## What Feed Page Must Refuse To Include

- full post detail payloads
- comments/replies trees
- full media ladders (`streamUrl`/`mp4` variants)
- per-item heavy enrichment trees
- unrelated recommendation diagnostics blobs

## Bootstrap + Page Coexistence Strategy

- Bootstrap remains first-render only.
- Page route owns continuation only.
- Shared lightweight shape keeps transitions cheap.
- Separate cache and dedupe keys prevent cross-route amplification.
- No optional/deferred blocking work in page path.
