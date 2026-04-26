# Suggested Friends / Find Friends Parity Audit (2026-04-24)

## Old Sunday UI behavior (native baseline)

- Modal surface is `FindFriendsEntry` + `FindFriendsHeavy` with:
  - header title `Suggested friends`
  - contacts permission teaser first
  - matched contact users section and suggested users section
  - per-row follow action + optimistic state
  - skip/done closes modal and writes completion flags
- Completion state and gating fields used on viewer:
  - `settings.contactsFriendIntroCompleted`
  - `settings.findFriendsSheetLastSeenAppVersion`
- Contact normalization in old native was client-side (`10` digit phone normalization in `FindFriends.heavy.tsx`), then POST to legacy backend.

## Old backendv1 routes + fields used by flow

- Contacts match:
  - `POST /api/users/phone-numbers`
  - `PUT /api/users/:userId/address-book`
  - `GET /api/users/:userId/contact-users`
- Suggested users:
  - `GET /api/users/suggested`
- Follow:
  - `POST /api/connections/follow/:followedId` (and related legacy variants)
- Viewer fields read/written:
  - `users/{viewerId}.addressBookUsers`
  - `users/{viewerId}.addressBookPhoneNumbers`
  - `users/{viewerId}.addressBookSyncedAt`
  - `users/{viewerId}.following` (plus subcollections in some paths)

## Current failure reason (before this fix)

- Native modal path still existed, but API calls were still wired to legacy `/api/*` social routes from:
  - `Locava-Native/src/data/api/users.api.ts`
  - `Locava-Native/src/data/repos/connectionsRepo.ts`
- Backendv2 did not expose social onboarding endpoints for:
  - contact sync
  - reusable suggested-friends feed
- Resulting regressions:
  - contact matching reliability depended on legacy endpoints
  - suggested friends source/ranking duplicated in native and not reusable
  - follow from modal was not guaranteed to hit canonical v2 mutation path

## Backendv2 architecture changes implemented

- Added reusable social contracts:
  - `src/contracts/surfaces/social-contacts-sync.contract.ts`
  - `src/contracts/surfaces/social-suggested-friends.contract.ts`
- Added reusable repository/service:
  - `src/repositories/surfaces/suggested-friends.repository.ts`
  - `src/services/surfaces/suggested-friends.service.ts`
- Added v2 routes:
  - `POST /v2/social/contacts/sync`
  - `GET /v2/social/suggested-friends`
- Added diagnostics fields in suggested response:
  - `routeName`
  - `viewerId`
  - `surface`
  - `returnedCount`
  - `sourceBreakdown`
  - `payloadBytes`
  - `dbReads`
  - `queryCount`
  - `cache hit/miss`
  - `dedupe count`
  - `excludedAlreadyFollowingCount`
- Added cache invalidation on follow/unfollow in v2 mutation repository:
  - `src/repositories/mutations/user-mutation.repository.ts`

## Native integration updates

- `users.api.ts` now routes contact sync-related calls through `/v2/social/contacts/sync` and suggestion hydration via `/v2/social/suggested-friends`.
- `connectionsRepo.ts` now routes:
  - follow -> `/v2/users/:userId/follow`
  - unfollow -> `/v2/users/:userId/unfollow`
  - suggested users -> `/v2/social/suggested-friends`
- This restores parity behavior while moving transport to Backendv2 canonical paths.

## Response shapes (v2)

- `POST /v2/social/contacts/sync`:
  - `matchedUsers: UserSuggestionSummary[]`
  - `matchedCount: number`
  - `syncedAt: number`
- `GET /v2/social/suggested-friends`:
  - `users: UserSuggestionSummary[]`
  - `sourceBreakdown: Record<string, number>`
  - `generatedAt: number`
  - `etag?: string`
  - `diagnostics: { ... }`

## Performance/read budget design

- No native users collection scans (all matching/ranking on backend).
- Suggestions cached per viewer/surface with short TTL (30s).
- Contact sync is mutation path; suggestion cache invalidates after sync + follow/unfollow.
- User payloads are lightweight summary records only.
- Ranking is deterministic and deduped by `userId`.

## Tests and manual verification

- Added backend tests:
  - `src/routes/v2/social.routes.test.ts`
  - covers:
    - phone normalization match
    - email normalization match
    - suggestions returned even without contacts
    - follow invalidates and excludes followed users
- Debug scripts added:
  - `npm run debug:social:suggested-friends`
  - `npm run debug:social:contacts-sync`
- Curl verification examples:

```bash
curl -sS "http://127.0.0.1:8080/v2/social/suggested-friends?limit=20&surface=onboarding" | jq
```

```bash
curl -sS -X POST "http://127.0.0.1:8080/v2/social/contacts/sync" \
  -H "Content-Type: application/json" \
  -H "x-viewer-id: debug-viewer" \
  -H "x-viewer-roles: internal" \
  -d '{"contacts":[{"name":"Test User","phoneNumbers":["6507046433"],"emails":[]}]}' | jq
```

## Files changed

- Backendv2:
  - `src/contracts/surfaces/social-contacts-sync.contract.ts`
  - `src/contracts/surfaces/social-suggested-friends.contract.ts`
  - `src/repositories/surfaces/suggested-friends.repository.ts`
  - `src/services/surfaces/suggested-friends.service.ts`
  - `src/routes/v2/social-contacts-sync.routes.ts`
  - `src/routes/v2/social-suggested-friends.routes.ts`
  - `src/routes/v2/social.routes.test.ts`
  - `src/repositories/mutations/user-mutation.repository.ts`
  - `src/app/createApp.ts`
  - `src/routes/contracts.ts`
  - `scripts/debug-social-suggested-friends.mts`
  - `scripts/debug-social-contacts-sync.mts`
  - `package.json`
- Native:
  - `src/data/api/users.api.ts`
  - `src/data/repos/connectionsRepo.ts`
