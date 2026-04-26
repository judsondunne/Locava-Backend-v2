# Profile Bootstrap Discovery (Native + Legacy Backend)

## Scope Reviewed

- Native profile screen flow in `Locava-Native/src/features/profile/*`
- Native profile bootstrap repo path in `Locava-Native/src/data/repos/profileRepo.ts`
- Legacy backend profile bootstrap in `Locava Backend/src/controllers/profile.controller.ts` and `src/services/profile/profile.service.ts`

## What the Native Profile Screen Renders Immediately

Profile shell/heavy path renders:

- header identity: avatar, name, handle, bio
- counts: followers, following, posts
- action buttons: edit/share
- tabs metadata: `grid`, `saved`, `likes`, `map`
- posts grid as lightweight tiles (not full post payload)

The native type contract confirms this shape:

- `viewer`
- `counts`
- `grid.items[]` as lightweight `GridThumb`
- `grid.nextCursor`

## First-Render Requirements (Must Be Fast)

Required to open profile quickly:

1. profile header summary (`userId`, `name`, `handle`, `profilePic`, optional `bio`)
2. counts summary (`posts`, `followers`, `following`)
3. viewer relationship/self context (for actions/state)
4. tab metadata (enabled tabs)
5. first grid slice with lightweight tiles only
6. cursor for next page

## Needed Shortly After First Render (Deferred)

- non-critical enrichment (e.g. badges/group summary, optional decorations)
- optional relationship extras (mutuals/secondary state)

These must not block base profile open.

## Background-Only Work

Observed in current system and should remain background-only:

- image/post metadata warmups
- extra post hydration for missing thumbs
- best-effort cache warming
- optional group list enrichment

## Current Profile Actions in Native

- open followers/following modal
- edit profile
- share profile
- tab switching (grid/saved/likes/map)
- pull-to-refresh
- load next grid page via cursor

## Grid Data Actually Needed for Initial Display

For first visible grid rows, native only needs lightweight tile data:

- `postId`
- `thumbUrl`
- `mediaType`
- optional `aspectRatio`
- ordering fields (`updatedAtMs` / cursor continuity)
- optional lightweight flags (`processing`, `processingFailed`)

Not needed for bootstrap:

- full post content blobs
- full viewer-per-post enrichment
- heavy post relationship trees

## Current Client/Backend Shape Expectations

Native currently calls `/api/profile/me/bootstrap` with default `limit=30` and expects:

- `viewer`
- `counts`
- `grid.items` + `grid.nextCursor`
- ETag/304 behavior

## Likely Slowness Causes Today

1. **Large first page default** (`limit=30`) for bootstrap.
2. **Follow-up post hydration** in client (`postRepo.getPostsByIds`) for thumb repair/warmup can add extra reads.
3. **Additional connection count sync calls** after bootstrap when counts missing.
4. **Auxiliary group fetch** (`fetchDiscoverableGroups` limit 120) in heavy profile path.
5. **Potential repeated profile fetch cycles** due to refresh triggers and session events.

## What Is Likely Overfetched Today

- too many grid items on first response for heavy users
- post metadata hydration beyond what first paint needs
- non-critical profile adornments in near-first-paint window

## V2 Profile Bootstrap Recommendations

`GET /v2/profiles/:userId/bootstrap` should include:

- lean profile header summary
- counts summary
- minimal viewer relationship state
- tab metadata
- first grid slice only (lightweight tiles, strict limit)
- cursor metadata for next page
- explicit deferred/background sections + degraded/fallback flags

Should be moved out of bootstrap:

- deep grid pagination history
- heavy per-post enrichments
- optional profile embellishments

## Heavy User Safety Direction

Reference heavy user for testing:

- `aXngoh9jeqW35FNM3fq1w9aXdEh1`

Rules:

- strict first-slice cap (target 12)
- cursor pagination only
- no load-all-then-slice
- no per-post enrichment storm in bootstrap path
