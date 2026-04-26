# Feed Post Detail Discovery (Native + Legacy)

## Scope Reviewed

- Native feed open flow in:
  - `Locava-Native/src/features/home/reels/ReelsCellContent.tsx`
  - `Locava-Native/src/features/home/reels/ReelsCellHeavy.tsx`
  - `Locava-Native/src/features/home/reels/ElevatableReelsCell.heavy.tsx`
  - `Locava-Native/src/features/liftable/liftableStore.ts`
- Legacy backend post endpoints in:
  - `Locava Backend/src/controllers/posts.controller.ts`
- Current v2 feed/profile contracts for shape reuse.

## What Viewer Needs On Feed Item Open

For feed card -> viewer open, first render needs:

- selected post identity and media startup-safe asset info
- minimal author identity
- minimal social summary
- viewer state (`liked`, `saved`)
- caption/time metadata

This is enough to open immediately while richer/optional data can load later.

## First Render vs Deferred vs Background

- **First-render:** selected post detail + shared card/author/social/viewer summaries.
- **Deferred:** comments preview only (timeout/fallback guarded).
- **Background-only:** optional comments-next/social-refresh hints.

## What Old System Likely Overfetches

- broad post payload and side trees for a single open
- repeated author/social shaping across feed, search, liftable paths
- rapid re-open of same post triggering duplicate fetch/shaping

## Single Post vs Neighboring Slice

Discovery indicates single-post first open is sufficient.  
Neighboring slice should stay out of critical path and be considered separately later.

## Existing v2 Shape Reuse Opportunity

Current feed bootstrap/page already use a lightweight card summary shape:

- `postId`, `author`, `captionPreview`, `media` startup hints, `social`, `viewer`, `updatedAtMs`

This should be reused in detail as `cardSummary` to prevent schema drift.

## Shared Entity Standardization Direction

Standardize and reuse:

- `PostCardSummary`
- `AuthorSummary`
- `SocialSummary`
- `ViewerPostState`
- `MediaStartupHints`
- `PostDetail` (extends from card summary, not a separate disconnected shape)

## Pressure Risks and Mitigation

Main risks:

- duplicate same-post opens while user taps quickly
- repeated author/social recomputation
- optional comments blocking critical open

Mitigation:

- in-flight dedupe by post/entity key
- explicit cache ownership for card/author/social/detail
- concurrency limits on repository paths
- deferred comments timeout/fallback
- strict payload policy and diagnostics visibility
