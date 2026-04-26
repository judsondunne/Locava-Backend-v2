# Shared Entities (v2)

This document defines canonical v2 shared entities, enforcement rules, and anti-patterns so feed/profile surfaces keep one schema and one shaping path.

## Canonical Shared Entities

### `AuthorSummary`

- Fields: `userId`, `handle`, `name`, `pic`
- Semantics: lightweight identity for cards and detail headers only
- Source of truth: `src/contracts/entities/post-entities.contract.ts`

### `SocialSummary`

- Fields: `likeCount`, `commentCount`
- Semantics: lightweight engagement snapshot only (no trees/lists)
- Source of truth: `src/contracts/entities/post-entities.contract.ts`

### `ViewerPostState`

- Fields: `liked`, `saved`
- Semantics: viewer-scoped mutable post flags
- Source of truth: `src/contracts/entities/post-entities.contract.ts`

### `MediaStartupHints`

- Fields: `type`, `posterUrl`, `aspectRatio`, `startupHint`
- Semantics: first-render media hints only
- Source of truth: `src/contracts/entities/post-entities.contract.ts`

### `PostCardSummary`

- Fields: `postId`, `rankToken`, `author`, `captionPreview`, `media`, `social`, `viewer`, `updatedAtMs`
- Semantics: canonical lightweight card shape reused by feed/profile internals
- Source of truth: `src/contracts/entities/post-entities.contract.ts`

### `PostDetail`

- Fields: `postId`, `userId`, `caption`, `createdAtMs`, `mediaType`, `thumbUrl`, `assets`, `cardSummary`
- Semantics: canonical open/detail entity
- Source of truth: `src/contracts/entities/post-entities.contract.ts`

## Enforcement Rules

- Build shared entities in service layer, never in routes.
- Repository layer returns raw/source records and never route-specific output shapes.
- Any feed/profile card-like payload must be derived from `PostCardSummary` semantics.
- Any detail-like payload must be derived from `PostDetail` semantics.
- Route contracts may adapt naming for backward compatibility, but semantic meaning must remain identical to shared entities.

## Cache + Reuse Rules

- Shared entities must use canonical entity cache keys:
  - `post:{postId}:card`
  - `post:{postId}:detail`
  - `post:{postId}:social`
  - `user:{userId}:summary`
  - `post:{postId}:viewer:{viewerId}:state`
- Route-level cache and entity-level cache are separate layers.
- Dedupe wraps cacheable entity loaders to prevent duplicate concurrent construction.

## Anti-Patterns To Avoid

- Re-defining author/social/viewer field names per route without explicit compatibility reason.
- Reconstructing the same entity shape in multiple orchestrators/routes.
- Caching only full route payload while repeatedly rebuilding shared entity fragments.
- Adding detail-only fields into bootstrap/page card payloads.

## Why This Prevents Bog-Down

- One shaping path per entity reduces CPU overhead under high request fanout.
- Entity cache reuse lowers repeated repository reads and repeated JSON construction.
- Consistent schema semantics prevent payload drift and contract entropy across surfaces.
