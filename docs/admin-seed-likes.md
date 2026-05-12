# Admin seed likes (Backend V2)

One-time admin/dev tool that backfills fake likes from the legacy Locava Web like-booster pool onto posts that are below a configurable minimum like count.

## What it does

- Scans `posts` in Firestore document-id order with pagination.
- Skips posts at or above the configured minimum existing likes.
- For eligible posts, picks a random target between the configured min/max, clamped to available seed likers.
- Writes canonical like docs at `posts/{postId}/likes/{userId}` and increments `likeCount` / `likesCount` on the post.
- Marks each seeded like with `seeded: true`, `seedSource: "backendv2_seed_likes_backfill"`, `seedRunId`, `suppressNotification: true`, and `suppressAnalytics: true`.
- Does **not** call the normal user-like route, achievements, activity feed, push, follower events, or analytics pipelines.

## Configuration

All run settings are configured in the UI at `GET /admin/seed-likes` and sent in the JSON body of each POST action as `{ "config": { ... } }`.

| Field | Default | Meaning |
| --- | --- | --- |
| `allowWrites` | `false` | Must be `true` for write-first / write-all |
| `minExistingLikes` | `10` | Skip posts at/above this count |
| `targetMin` | `18` | Random target lower bound |
| `targetMax` | `24` | Random target upper bound |
| `batchSize` | `200` | Posts page size |
| `maxPostsPerRun` | `0` | `0` = no cap |
| `useOldWebLikers` | `true` | Load likers from `likeBoosterSetting/global` |
| `runIdPrefix` | `seed-likes` | Prefix for `seedRunId` |

The page also persists the last form values in browser `localStorage` for convenience.

## Dry-run first flow

1. Open `GET /admin/seed-likes`.
2. Set the form values.
3. Click **Dry run first eligible post** or `POST /admin/seed-likes/dry-run-first` with the same config JSON.
4. Review the preview: post id, current count, target, selected seed likers, like doc paths/payloads, and post counter increments.
5. Nothing is written.

## Write-first flow

1. Enable **Allow writes for this session** in the page.
2. Click **Write first eligible post** or `POST /admin/seed-likes/write-first` with `allowWrites: true`.
3. The first eligible post is processed in a per-post transaction and the run stops.

## Write-all flow

1. Enable **Allow writes for this session** in the page.
2. Click **Write all eligible posts** or `POST /admin/seed-likes/write-all` with `allowWrites: true`.
3. Poll `GET /admin/seed-likes/status` until `isRunning=false`.
4. Use **Stop current run** or `POST /admin/seed-likes/stop` to request a cooperative stop.

## Rollback notes

- Seeded likes are identifiable via `seeded`, `seedSource`, and `seedRunId`.
- Roll back by deleting `posts/{postId}/likes/{userId}` docs with `seedSource === "backendv2_seed_likes_backfill"` and decrementing post counters by the number removed.
- Optional cleanup: remove matching `users/{userId}/likedPostsMeta/{postId}` rows and `likedPosts` array entries for seed users.
- Re-running the tool is idempotent: existing like doc ids prevent duplicate writes and counters are not double-incremented.

## Warning

This is for seed/demo/fake users from the legacy like-booster pool only. It does not send notifications, push, or analytics events.
