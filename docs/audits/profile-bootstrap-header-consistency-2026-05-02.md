# Profile bootstrap header consistency audit — 2026-05-02

## Root cause

The Redis/global cache key `user:{userId}:summary` (`entityCacheKeys.userSummary`) was shared between:

1. **Canonical profile header** — full `FirestoreProfileHeader` including `counts.posts|followers|following` and `profilePic`.
2. **Lightweight chat participant previews** — `UserSummary` (`{ userId, handle, name, pic }`) written by `chats.repository.ts` when hydrating inbox/thread participants.

`ProfileFirestoreAdapter.getProfileHeader` treated **any** cached object under `userSummary` as a complete profile header and returned it with `readCount: 0`. Chat previews lack `counts` and use **`pic`** instead of **`profilePic`**. Downstream `toProfileHeaderDTO` coerced missing counts to **0** and missing photo to **null**, while the grid continued to load from `posts` queries keyed by the same `userId`. That matches production logs: fast latency, zero Firestore reads on header, healthy grid/collections, empty-looking header.

Opening a profile **from chat** increased the chance chat had recently populated `userSummary` with a preview-shaped object.

## Fixes (summary)

| Area | Change |
|------|--------|
| Cache separation | Profile header entity cache now uses **`user:{userId}:profileHeader:v1`** (`entityCacheKeys.profileHeaderCanonical`) only for canonical headers; includes `_cacheSchemaVersion` and strict completeness checks. |
| Completeness | `isCompleteProfileHeaderEntityCache` rejects legacy/preview shapes; incomplete canonical entries are deleted and rebuilt. |
| Invalidation | `profileHeaderCanonical` evicted on follow/unfollow (`evictCachesAfterFollowGraphMutation`), user.follow/unfollow entity path, post delete, posting.complete. |
| Bootstrap cache | Evict shaped bootstrap when **grid has items but posts count is 0**; repair line-up: `postsCountEffective = max(header, gridPreview.length)` when invariant violated. |
| Bootstrap segment | Canonical segment **`profile-bootstrap-v2`** with legacy **`profile-bootstrap-v1`** still evicted for mixed deployments. |
| Logging | `profile route completed` logs **`headerCounts`** (followers, following, posts), **`headerMedia`**, optional **`profileHeaderRepair`**. |
| Debug | `GET /debug/local/profile-header/:userId` for local inspection. |
| Native | `Locava-Native/src/profile/mergeProfilePreviewWithBootstrap.ts` — merge order so preview cannot overwrite bootstrap counts/avatar. |

## Bug path (chat → profile)

1. Chat loads participants → writes **`user:{id}:summary`** with `{ pic, handle, name }`.
2. User taps profile → **`GET /v2/profiles/:userId/bootstrap`**.
3. **`getProfileHeader`** returned cached **`userSummary`** as if it were a full header → zeros / null avatar.
4. Grid/collections used separate cache keys and Firestore queries → still worked.

After fix: header hydration **never** reads chat preview cache; it uses **`profileHeaderCanonical`** only.

## Canonical user ID / alias

No evidence this incident required `google_*` vs Firebase UID aliasing — grid and identity strings both keyed off the same route `userId`. Optional future work: bounded lookup via a `canonicalUserId` field on `users/{id}` if split documents appear.

## Verification commands

```bash
cd "Locava Backendv2"
npm run typecheck
npm run test:deterministic
npx vitest run src/domains/profile/profile-header-cache.test.ts src/orchestration/surfaces/profile-bootstrap.orchestrator.test.ts src/cache/profile-follow-graph-cache.test.ts
```

### Local debug

```bash
curl -sS "http://127.0.0.1:8080/debug/local/profile-header/google_106313189499125710920" | jq
```

(Requires `ENABLE_LOCAL_DEV_IDENTITY=1` or equivalent local debug gate used elsewhere for `/debug/local/*`.)

## Tests run

- Added: `profile-header-cache.test.ts`, orchestrator grid repair test; updated `profile-follow-graph-cache.test.ts` for v2 canonical segment.

## Remaining risks

- **`userSummary`** remains shared by feed/comments/search; those shapes differ from chat but are still not full profile headers. They **do not** replace profile header anymore for bootstrap.
- Payload **`debug`** is always populated on profile bootstrap (small overhead) for observability and logging.
