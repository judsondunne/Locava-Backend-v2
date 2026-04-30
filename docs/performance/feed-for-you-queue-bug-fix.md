# Feed For You Queue Bug Fix

## Root Cause

The old `queue-reels-v1` backend only queued reels. Once `reelQueueIndex` reached `reelQueueCount`, the service dropped into a completely different regular-post path that was not queue-based at all.

That regular fallback:

- queried the same recent post window on every request
- filtered “fresh” regulars using `regularServedRecent`
- if it ran out of “fresh” rows in that same window, it immediately filled from `recycled` rows from the same window
- never persisted a `regularQueue`
- never persisted a `regularQueueIndex`
- advanced the page cursor, but not the underlying regular source

## Why `regularCount` Was `0` While `recycledRegularCount` Was `5`

In `feed-for-you.service.ts`, the old `selectRegularPosts(...)` split the regular window into:

- `fresh`: regular posts not in `regularServedRecent`
- `recycled`: regular posts already in `regularServedRecent`

When the recent window had no unserved regulars left, `fresh.length` became `0`, but the service still filled the page from `recycled`, so the debug output became:

- `regularCount = 0`
- `recycledRegularCount = 5`

That is why the logs showed “real” output even though the normal regular path had effectively stopped advancing.

## Why The Same Regular Posts Repeated

The old code re-ran `fetchRecentWindow(REGULAR_WINDOW_LIMIT)` every page. That query always read the same newest posts. Since there was no persisted regular queue, the fallback kept re-evaluating the same small pool and recycling the same rows after `regularServedRecent` blocked the fresh subset.

The result was:

- same recent regular window
- same recycled subset
- same returned IDs

## Why `regularQueueIndex` Did Not Exist Or Advance

The state model in `feed-for-you.repository.ts` only had:

- `reelQueue`
- `reelQueueIndex`
- `regularCursorTime`
- `regularCursorPostId`
- `regularServedRecent`

There was no `regularQueue`, `regularQueueCount`, or `regularQueueIndex` field in the document, so there was nothing to advance after reels were exhausted.

## Why The Page Cursor Advanced While Posts Did Not Change

The old cursor encoded only:

- `page`
- `mode`
- `reelQueueIndex`

The cursor page number could increase from page 1 to page 2 to page 3, but regular fallback never used any persisted regular position. It simply queried the same recent window again, so the client continuation token changed while the returned regular IDs did not.

## Why Requests Still Did 31 Reads And 6 Writes

The hot path after reel exhaustion still did too much work:

- 1 feed state doc read
- up to 30 collection-query reads from `fetchRecentWindow(30)`
- 5 blocking `feedServed` writes
- 1 blocking `feedState` write

That is how the route ended up around:

- `reads = 31`
- `writes = 6`

even on tiny pages.

## Why Latency Stayed High

Latency stayed high because the request still did all of the following synchronously:

- read feed state
- run a collection query for the regular window
- filter the regular window in memory
- write one `feedServed` doc per returned post
- write the updated feed state

That meant the “queue-based” reel engine still fell back to a query-heavy, write-heavy regular path once reels finished.

## Fix

The new `queue-reels-regular-v2` path removes that split-brain behavior.

Now the backend stores both:

- `reelQueue` + `reelQueueIndex`
- `regularQueue` + `regularQueueIndex`

Regular posts are served from `regularQueue` by ID, just like reels. After queues exist, the warm page path is:

- 1 feed state read
- bounded post-by-ID reads
- 1 feed state write

The old recycled regular window path is no longer used by the canonical `/v2/feed/for-you` engine.
