# Map + Directory Discovery (Native + Legacy Audit)

Date: 2026-04-20  
Scope: Discovery only (no route implementation in this phase).

## What Exists Today

Primary map files:

- `Locava-Native/src/features/map/Map.entry.tsx`
- `Locava-Native/src/features/map/Map.content.tsx`
- `Locava-Native/src/features/map/MapContentChrome.tsx`
- `Locava-Native/src/features/map/data/mapIndex.api.ts`
- `Locava-Native/src/features/map/data/mapIndex.store.ts`

Directory/find-friends files:

- `Locava-Native/src/features/findFriends/FindFriends.heavy.tsx`
- `Locava-Native/src/data/users/userDirectory.ts`
- `Locava-Native/src/data/api/users.api.ts`
- `Locava-Native/src/data/repos/connectionsRepo.ts`

Legacy backend routes referenced:

- `/api/v1/product/map/bootstrap`
- `/api/map/index`
- `/api/posts` (adapter fallback)
- `/api/users/all`
- `/api/shared-data/users/batch`
- `/api/users/:userId/most-active-location`
- `/api/users/:userId/cohort-users`
- `/api/users/phone-numbers`, `/api/users/:userId/address-book`, `/api/users/:userId/contact-users`

## Current Map Hydration Pattern

Composite behavior:

1. Marker index fetch (product bootstrap, legacy map-index, or posts adapter fallback).
2. Marker filtering/sorting client-side.
3. Thumb repair / metadata enrichment.
4. On-demand full post hydration for opened items.

The map path is explicitly multi-source and can fan out under cold cache.

## Current Directory/Find-Friends Pattern

- Suggested users + contact matching + follow graph are combined in one heavy flow.
- Contacts permissions, contact parsing, phone matching, address-book sync, and suggested users all overlap.
- Directory endpoints can still request large pages (`/api/users/all` with high limits).
- Cohort/location-derived users are separate enrichment lanes.

## First Render Needs

Map first render needs:

- marker index payload (postId, lat/lng, media hint/thumb, ts, activity tags, optional user context)
- bounded by viewport and limit

Directory first render needs:

- first page of suggested users (lean identity card only)
- optional contact-derived matches can remain deferred

## Biggest Pressure Risks

1. Geo/list overlap (map markers + list + hydration at same time).
2. Fallback adapter chain (`productBootstrap -> map/index -> posts`) can multiply load variance.
3. Large directory list pulls (`users/all`) and paging amplification.
4. Contact matching batches and follow refresh overlap.
5. Duplicate index warm calls + thumb repair fanout during frequent tab focus.

## Smallest Safe v2 Slice

Map slice 1 (safe):

- `map.bootstrap.get` returning only marker index (lean shape, strict limit, cursor/watermark)
- no weather, no heavy social enrich, no cluster analytics, no broad post hydration in same route

Directory slice 1 (safe):

- `directory.users.get` paginated lean users list
- optional search query support
- no contacts upload/matching in first slice
- no cohort/location enrichment in first slice

## What Should Not Be Built First

- Full contacts ingestion + matching + directory in one release.
- Mixed map + weather + social batch + full post hydration fanout route.
- Any unbounded user list endpoint parity clone.
- Multi-source fallback chain hidden inside one route without explicit diagnostics markers.

