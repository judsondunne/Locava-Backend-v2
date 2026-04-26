# Source-of-Truth Audit: Profile Bootstrap + Profile Post Detail

Date: 2026-04-20

## Current State (Before This Slice)

Profile bootstrap and profile post detail repositories were deterministic/mock-backed:

- `profile.repository.ts`
  - header/counts: seeded
  - relationship: seeded + in-memory mutation overlay
  - grid preview: generated thumbnails/items
- `profile-post-detail.repository.ts`
  - detail payload: generated from post-id pattern
  - comments preview: deterministic deferred payload

## Chosen Safe Slice

Integrated in this phase:

1. profile bootstrap header + relationship + counts
2. bounded bootstrap preview slice
3. selected profile post detail

Not integrated in this phase:

- full profile grid continuation path (`/v2/profiles/:userId/grid`)
- broad profile list/history scans
- deferred comments source integration

## Real Doc/Query Strategy

### Profile bootstrap

- Header/counts:
  - doc: `users/{userId}`
  - narrow fields: identity/profile + `counts.*`
- Relationship:
  - docs:
    - `users/{viewerId}/following/{targetUserId}`
    - `users/{targetUserId}/following/{viewerId}`
  - plus in-memory mutation overlay for write-read coherence
- Bounded preview slice:
  - query: `posts.where(userId == :userId).orderBy(createdAtMs desc).limit(gridLimit + 1)`
  - narrow fields: `mediaType`, `thumbUrl`, `updatedAtMs`, `aspectRatio`, `processing*`

### Profile post detail

- docs:
  - `posts/{postId}` (validate `userId` matches route)
  - `users/{userId}` (author summary fields only)
- narrow post fields: caption/media/createdAt/assets/social counters
- social uses source values plus in-memory mutation overlay for like/unlike coherence

## Read Amplification Risks + Mitigation

Risks:

- loading many posts then slicing in memory
- per-preview-item detail fan-out
- heavy post-detail joins on open

Mitigation:

- preview query is bounded by route `gridLimit`
- no per-item detail hydration in bootstrap
- post detail reads only selected post + author docs (bounded to 2 reads)

## Timeout/Fallback Discipline

- each source-of-truth path is timeout-bounded
- on timeout/failure, record `timeouts` + `fallbacks` diagnostics
- deterministic existing path is used as fallback
- adapter marks itself temporarily unavailable for 5s after timeout to avoid repeated “slow forever” loops

## Budget Risk Assessment

Most sensitive routes:

- `profile.bootstrap.get` latency/read budget due to combined header + relationship + preview
- `profile.postdetail.get` latency if source doc read stalls

Mitigation:

- strict narrow selects
- bounded preview limit
- timeout-capped source calls with immediate fallback
- existing route/entity cache + dedupe/concurrency preserved
