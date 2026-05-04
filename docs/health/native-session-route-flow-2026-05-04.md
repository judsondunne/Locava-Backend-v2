# Native Session Route Flow (2026-05-04)

This map is extracted from current Locava Native call-sites and Backendv2 contracts to keep the simulator aligned with real app behavior.

## Simulator Session Plan (exact order and concurrency)

1. **Cold open first-paint (serial)**
   - `GET /v2/auth/session`
   - `GET /v2/feed/for-you/simple?limit=<PAGE_SIZE>`
2. **Deferred/background fanout (parallel)**
   - `GET /v2/feed/bootstrap`
   - `GET /v2/notifications`
   - `GET /v2/chats/inbox`
   - `GET /v2/achievements/bootstrap`
   - `GET /v2/achievements/snapshot`
   - `GET /v2/achievements/hero`
   - `GET /v2/legends/events/unseen`
   - `GET /v2/social/suggested-friends`
3. **Feed fast-scroll pagination**
   - Repeat `GET /v2/feed/for-you/simple?cursor=...` up to `MAX_PAGES`
4. **Video readiness probes**
   - `HEAD` and ranged `GET bytes=0-2047` for top N selected video URLs from feed assets
5. **Radius flow**
   - For each radius (1/10/25/50): `GET /api/v1/product/reels/near-me` + `GET /api/v1/product/reels/near-me/count`
6. **Map/Search/Profile/Collections/Detail hydration**
   - `GET /v2/map/markers?payloadMode=compact`
   - `GET /v2/search/home-bootstrap`, `GET /v2/search/suggest`, `GET /v2/search/results`, `GET /v2/search/mixes/bootstrap`
   - `GET /v2/feed/items/:postId/detail`, `GET /v2/posts/:postId/detail`, `POST /v2/posts/details:batch` (read-like)
   - `GET /v2/profiles/:userId/bootstrap`, `GET /v2/profiles/:userId/grid`
   - `GET /v2/collections`, `GET /v2/places/reverse-geocode`

## Route Flow Matrix

| Screen/action | Route(s) | Method/path | Expected routeName | Read-only vs mutating | Phase | Native-dependent fields | Include in safe simulator |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Signed-in bootstrap | session bootstrap | `GET /v2/auth/session` | `auth.session.get` | read-only | first-paint | `firstRender.viewer`, `firstRender.account.viewerReady`, `deferred.viewerSummary` | yes |
| Home feed open | For You simple | `GET /v2/feed/for-you/simple` | `feed.for_you_simple.get` | read-only | first-paint | `items[]`, `nextCursor`, `exhausted`, `debug` | yes |
| Feed fallback bootstrap | home bootstrap | `GET /v2/feed/bootstrap` | `feed.bootstrap.get` | read-only | deferred-interactive | `firstRender.feed.items`, `page.nextCursor` | yes |
| Feed pagination | For You cursor page | `GET /v2/feed/for-you/simple?cursor=` | `feed.for_you_simple.get` | read-only | deferred-interactive | `items[]`, `nextCursor`, `exhausted` | yes |
| Feed card -> detail | feed item hydrate | `GET /v2/feed/items/:postId/detail` | `feed.itemdetail.get` | read-only | deferred-interactive | full post media/assets for liftable open | yes |
| Canonical post detail | post hydrate | `GET /v2/posts/:postId/detail` | `posts.detail.get` | read-only | deferred-interactive | canonical `assets`, `variants`, `author`, social | yes |
| Batch detail hydrate | post batch hydrate | `POST /v2/posts/details:batch` | `posts.detail.batch` | read-like POST | deferred-interactive | `posts[]` hydrated fields | yes (explicitly whitelisted in read-only) |
| First video startup | CDN asset probe | `HEAD/GET(range)` selected URL | n/a (external media) | read-only | first-paint/deferred | `content-type`, `accept-ranges`, reachability | yes |
| Radius feed | compat near-me feed | `GET /api/v1/product/reels/near-me` | `compat.reels.near_me` | read-only | deferred-interactive | `posts[]`, `nextCursor`, distance/radius shape | yes |
| Radius count | compat near-me count | `GET /api/v1/product/reels/near-me/count` | `compat.reels.near_me_count` | read-only | deferred-interactive | `count` | yes |
| Map open | compact markers | `GET /v2/map/markers?payloadMode=compact` | `map.markers.get` | read-only | deferred-interactive | compact marker set, ids for tap hydration | yes |
| Search home | home bootstrap | `GET /v2/search/home-bootstrap` | `search.home_bootstrap.v1` | read-only | deferred-interactive | `suggestedUsers`, `activityMixes` | yes |
| Search suggest | typeahead | `GET /v2/search/suggest?q=` | `search.suggest.get` | read-only | deferred-interactive | user/activity/location suggestion rows | yes |
| Search results | committed results | `GET /v2/search/results` | `search.results.get` | read-only | deferred-interactive | paged results, cards/mixes | yes |
| Search mixes | mixes bootstrap | `GET /v2/search/mixes/bootstrap` | `search.mixes.bootstrap.get` | read-only | deferred-interactive | mix cards, scoring/version | yes |
| Profile open | profile bootstrap | `GET /v2/profiles/:userId/bootstrap` | `profile.bootstrap.get` | read-only | deferred-interactive | header + first grid data | yes |
| Profile grid page | profile pagination | `GET /v2/profiles/:userId/grid` | `profile.grid.get` | read-only | deferred-interactive | grid cards and cursors | yes |
| Collections list | saved collections list | `GET /v2/collections` | `collections.list.get` | read-only | deferred-interactive | `items[]`, `page.nextCursor` | yes |
| Chats background | inbox list | `GET /v2/chats/inbox` | `chats.inbox.get` | read-only | background | conversation previews/unread counts | yes |
| Notifications background | notifications list | `GET /v2/notifications` | `notifications.list.get` | read-only | background | paged notifications | yes |
| Achievements background | bootstrap/snapshot/hero | `GET /v2/achievements/bootstrap|snapshot|hero` | `achievements.bootstrap.get`, `achievements.snapshot.get`, `achievements.hero.get` | read-only | background | status + celebration + hero payloads | yes |
| Legends background | unseen events | `GET /v2/legends/events/unseen` | `legends.events.unseen.get` | read-only | background | event list + poll hints | yes |
| Social background | suggested friends | `GET /v2/social/suggested-friends` | `social.suggested_friends.get` | read-only | background | `users[]`, `mutualCount`, paging | yes |
| Location read path | reverse geocode | `GET /v2/places/reverse-geocode` | `places.reverse_geocode.get` | read-only | background | formatted address | yes |

## Explicitly excluded in safe mode

- Any create/update/delete/follow/unfollow/like/comment/save/unsave/send-message/stage/finalize/publish/upload endpoints.
- POST routes are blocked unless explicitly whitelisted as read-like (`/v2/posts/details:batch`).
