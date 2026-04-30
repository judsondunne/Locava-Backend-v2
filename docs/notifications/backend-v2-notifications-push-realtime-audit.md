# Backend v2 Notifications / Push / Realtime Audit

Date: 2026-04-30

## Scope

Restore Backend v2 notifications, push, Native realtime banners, and Native chat realtime so they remain compatible with the old Locava backend notification framework and existing Native/Web routing expectations.

Primary systems audited:

- `Locava Backend`
- `Locava Backendv2`
- `Locava-Native`
- `Locava-Native-Old`
- `Locava Web`

## Old Backend Notification Action Matrix

Primary notification service:

- `Locava Backend/src/services/notifications.service.ts`

Canonical storage paths:

- Notification docs: `users/{recipientUserId}/notifications/{notificationId}`
- Aggregation state: `users/{recipientUserId}/notificationAggState/{stateKey}`
- New-post dedupe sentinel: `postNotifications/{postId}`

Old notification-producing actions confirmed:

| Action | Old caller(s) | Type string | Notes |
| --- | --- | --- | --- |
| Follow user | `users.service.ts`, `connections.service.ts` | `follow` | Self-notifications skipped |
| Contact joined | `users.service.ts` | `contact_joined` | Deduped by `type + senderUserId` |
| Like post | `posts.service.ts` | `like` | 24h aggregation by post; first 2 individual, later summary |
| Create comment | `comments.service.ts` | `comment` | Only post owner notified |
| Mention in comment | `comments.service.ts` | `mention` | Carries `commentId` |
| Tag / mention in post | `directPostUpload.controller.ts`, `directPostProcessor.worker.ts` | `mention` | Message is `tagged you in a post.` |
| New post to followers | `directPostUpload.controller.ts`, `directPostProcessor.worker.ts` | `post` | 24h aggregation by creator |
| Chat message | `chats.service.ts` | `chat` | Recipients are all participants except sender |
| Group joined | `groups.service.ts` | `group_joined` | Group route embedded in metadata |
| Group faceoff | `groups.service.ts` | `group_faceoff` | Exists in service even though some old TS unions omit it |
| Group invite | `groups.service.ts` | `group_invite` | Group route embedded in metadata |
| Collaborator invite | `collections.service.ts` | `invite` | Opens collections flow |
| Collection shared | service exists, old route/tests present | `collection_shared` | Production caller not fully confirmed during audit |
| Place follow | service exists | `place_follow` | Production caller not fully confirmed during audit |
| Audio like | service exists | `audio_like` | Production caller not fully confirmed during audit |
| System notification | `achievementChallenges.service.ts` and test/admin paths | `system` | Sender is synthetic `system` / `Locava` |

Not found in old production flow:

- Separate reply notification type
- Comment-like notification type
- Unlike notification cleanup
- Unfollow notification cleanup

## Old Notification Document Schemas

Shared required fields for most old notification docs:

- `senderUserId`
- `type`
- `message`
- `timestamp`
- `priority`

Shared embedded sender fields when available:

- `senderName`
- `senderProfilePic`
- `senderUsername`

Shared read-state fields:

- Most notification types: `read: false`
- Chat notifications: `seen: false`

Recipient is implicit in path only. Old docs do not store `recipientUserId`.

### `follow`

- Path: `users/{recipientUserId}/notifications/{autoId}`
- Required fields:
  - `senderUserId`
  - `senderName?`
  - `senderProfilePic?`
  - `senderUsername?`
  - `type: "follow"`
  - `message: "followed you."`
  - `timestamp: serverTimestamp`
  - `read: false`
  - `priority: "low"`

### `contact_joined`

- Same path
- Required fields:
  - `type: "contact_joined"`
  - `message: "just joined Locava. Tap to view their profile."`
  - `read: false`
  - `priority: "medium"`
- Metadata:
  - `route: "/userDisplay/userDisplay"`
- Dedupe:
  - query existing docs where `type == "contact_joined"` and `senderUserId == joinedUserId`

### `like`

- Same path
- Individual notification required fields:
  - `type: "like"`
  - `postId`
  - `message: "liked your post."`
  - `read: false`
  - `priority: "high"`
- Individual metadata:
  - `postTitle`
- Aggregation state path:
  - `users/{recipientUserId}/notificationAggState/like_{safePostId}`
- Aggregation behavior:
  - 24h window
  - first 2 unique likers each get their own notification row
  - additional likers update or create one summary row with `type: "like"`
  - duplicate liker inside active window is skipped
- Summary metadata:
  - `postTitle`
  - `aggregated: true`
  - `aggregationKind: "like_post"`
  - `orderedLikerIds`
  - `additionalLikerCount`
  - `totalUniqueLikers`
  - `individualCap`

### `comment`

- Required fields:
  - `type: "comment"`
  - `postId`
  - `commentId`
  - `message: "commented on your post."`
  - `read: false`
  - `priority: "medium"`
- Metadata:
  - `commentText`
  - `postTitle`

### `mention`

- Required fields:
  - `type: "mention"`
  - `postId`
  - `message`
  - `read: false`
  - `priority: "medium"`
- Comment mention metadata:
  - `commentId?`
  - `mentionText`
- Post tag variant:
  - same `type: "mention"`
  - message is `tagged you in a post.`
  - metadata includes `postTitle`

### `chat`

- Required fields:
  - `type: "chat"`
  - `chatId`
  - `message`
  - `timestamp: serverTimestamp`
  - `seen: false`
  - `priority: "medium"`
- Group chat body:
  - `From {chatName}: {message}`

### `invite`

- Required fields:
  - `type: "invite"`
  - `collectionId`
  - `message: invited you to collaborate on "{collectionName}".`
  - `read: false`
  - `priority: "medium"`
- Metadata:
  - `collectionName`

### `collection_shared`

- Required fields:
  - `type: "collection_shared"`
  - `collectionId`
  - `message: shared collection "{collectionName}" with you.`
  - `read: false`
  - `priority: "medium"`
- Metadata:
  - `collectionName`

### `group_joined`

- Required fields:
  - `type: "group_joined"`
  - `message: joined {groupName}.`
  - `read: false`
  - `priority: "medium"`
- Metadata:
  - `groupId`
  - `groupName`
  - `route: /groups/{groupId}`

### `group_invite`

- Required fields:
  - `type: "group_invite"`
  - `message: invited you to join {groupName}.`
  - `read: false`
  - `priority: "medium"`
- Metadata:
  - `groupId`
  - `groupName`
  - `route: /groups/{groupId}`

### `group_faceoff`

- Required fields:
  - `type: "group_faceoff"`
  - `message: {groupName} is now facing off against {opponentGroupName}.`
  - `read: false`
  - `priority: "high"`
- Metadata:
  - `groupId`
  - `groupName`
  - `opponentGroupId`
  - `opponentGroupName`
  - `route: /groups/{groupId}`

### `post`

- Required fields:
  - `type: "post"`
  - `postId`
  - `message: "just posted!"` for individual rows
  - `read: false`
  - `priority: "low"`
- Aggregation state path:
  - `users/{recipientUserId}/notificationAggState/newpost_{creatorId}`
- Aggregation behavior:
  - 24h window
  - first 2 posts get individual rows
  - additional posts update or create summary row
- Summary metadata:
  - `aggregated: true`
  - `aggregationKind: "following_post"`
  - `creatorUserId`
  - `orderedPostIds`
  - `additionalPostCount`
  - `totalPostsInWindow`

### `place_follow`

- Required fields:
  - `type: "place_follow"`
  - `placeId`
  - `message: started following "{placeName}".`
  - `read: false`
  - `priority: "low"`
- Metadata:
  - `placeName`

### `audio_like`

- Required fields:
  - `type: "audio_like"`
  - `audioId`
  - `message: "liked your audio."`
  - `read: false`
  - `priority: "low"`
- Metadata:
  - `audioTitle`

### `system`

- Required fields:
  - `senderUserId: "system"`
  - `senderName: "Locava"`
  - `senderProfilePic: "https://via.placeholder.com/150?text=Locava"`
  - `senderUsername: "locava"`
  - `type: "system"`
  - `message`
  - `timestamp: serverTimestamp`
  - `read: false`
  - `priority`
  - `metadata?`

## Old Push Payload Schema

Old push builder:

- `Locava Backend/src/services/notifications.service.ts`
- `buildExpoPushPayload(...)`

Common payload shape:

- `sound: "default"`
- `title`
- `body`
- `data.type`
- `data.senderUserId`
- `data.route`

Optional `data` fields used by routing:

- `collectionId`
- `collectionName`
- `postId`
- `chatId`
- `placeId`
- `audioId`
- `commentId`
- `groupId`
- `groupName`
- `postTitle`
- `profileUserId`

Route mapping:

- `like`, `comment`, `mention`, `post`, `post_discovery`, `push_image_test` -> `/display/display`
- `achievement_leaderboard`, `leaderboard_rank_up`, `leaderboard_rank_down`, `leaderboard_passed` -> `/achievements/leaderboard`
- `follow`, `contact_joined` -> `/userDisplay?userId={profileUserId}` or `/userDisplay/userDisplay`
- `group_joined`, `group_invite` -> `/groups/{groupId}` or `/map`
- `invite`, `collection_shared` -> `/collections/collection`
- `chat` -> `/chat/chatScreen`
- fallback -> `/map`

Body overrides:

- `like` -> `liked your post`
- `comment` -> `commented on your post`
- `mention` -> uses notification message
- `follow` -> `followed you`
- `chat` -> raw message
- `post` -> `just posted!`

Push delivery behavior:

- Reads token from `users/{userId}.expoPushToken`
- Skips non-fatally when token missing
- Sends to Expo API
- Stringifies `data` values
- Push failures never fail the action
- Invalid token cleanup was not observed in the old implementation

## Old Deep Link / Native Routing Expectations

Old Native routing sources:

- `Locava-Native-Old/app/contexts/NotificationContext.jsx`
- `Locava-Native-Old/src/components/NotifcationOverlay.jsx`

Expected Native behavior:

- Firestore realtime listener on `users/{userId}/notifications`
- `orderBy("timestamp","desc")`
- `limit(1)`
- initial snapshot ignored to avoid duplicate historical banners
- last notification id deduped in memory

Tap behavior:

- `chat` -> open exact chat thread
- `follow`, `contact_joined` -> profile
- `like`, `comment`, `mention`, `post` -> post detail
- `invite`, `collection_shared`, `addedCollaborator` -> collections
- `group_joined`, `group_invite` -> group

## Current Backend v2 Gaps

Current files:

- `Locava Backendv2/src/repositories/surfaces/notifications.repository.ts`
- `Locava Backendv2/src/services/surfaces/notifications.service.ts`
- `Locava Backendv2/src/orchestration/mutations/post-like.orchestrator.ts`
- `Locava Backendv2/src/orchestration/mutations/comments-create.orchestrator.ts`
- `Locava Backendv2/src/orchestration/mutations/user-follow.orchestrator.ts`
- `Locava Backendv2/src/orchestration/mutations/chats-send-message.orchestrator.ts`

Gaps:

- create path writes a v2-minimal notification row, not the old schema
- notification id is custom `n_<uuid>` instead of old auto-id `add()` behavior
- embedded sender fields are not preserved
- priority field missing
- chat notifications are not created at all by current chat send flow
- push publishing is not wired into v2 notifications
- old aggregation behavior is not implemented for likes or follower post notifications
- legacy `/api/notifications/*` mutation/test/push paths are still proxy-or-503 compat routes

## Current Native Gaps

Current files:

- `Locava-Native/src/features/notifications/pushNotifications.ts`
- `Locava-Native/src/features/chats/data/chatIndex.listener.ts`
- `Locava-Native/src/features/chatThread/data/thread.listener.ts`

Gaps:

- push token registration returns Expo token locally but does not sync to Backend v2
- notification realtime Firestore listener was removed
- chat inbox realtime listener was removed
- chat thread realtime listener was removed
- current in-app banners only come from foreground push listener, not Firestore notification rows

## Current Web Gaps

Current files:

- `Locava Web/src/services/notifications.service.js`
- `Locava Web/src/services/chats.service.js`

Observed state:

- polling-based notifications
- unread count intentionally excludes `chat`
- old notification route assumptions still exist in some push/test helper paths

## Config / Env Gaps

Verified env/config dependencies:

- Backend v2 port default is `8080`
- Local debug routes require `ENABLE_LOCAL_DEV_IDENTITY=1`
- Firestore source of truth requires admin credentials via:
  - `FIREBASE_PROJECT_ID`
  - `FIREBASE_CLIENT_EMAIL`
  - `FIREBASE_PRIVATE_KEY`
  - or `GOOGLE_APPLICATION_CREDENTIALS`
- Native push currently depends on:
  - `EXPO_PUBLIC_EXPO_PROJECT_ID`
  - Firebase public config for auth/app init

Known gap:

- no canonical Backend v2 push-token sync route is currently used by Native

## Implementation Plan

1. Replace the current v2 notification creator with a legacy-compatible factory + repository path that writes the exact old Firestore doc shapes for like, comment, follow, chat, mention, post, invite, collection_shared, group_invite, group_joined, group_faceoff, place_follow, audio_like, contact_joined, and system.
2. Port old push payload building into Backend v2 and make push async/non-blocking after notification creation.
3. Wire real Backend v2 like/comment/follow/chat orchestrators into that notification service.
4. Add a canonical Backend v2 push-token sync surface and re-enable Native token sync.
5. Restore Native Firestore realtime listeners for:
   - latest notification banner + unread/list refresh
   - chat inbox
   - chat thread
6. Add debug routes under `/debug/local/notifications/*` that call the same production services or production routes, not fake document writers.
7. Add compatibility and regression tests for:
   - old notification doc shapes
   - push payload shape
   - deep link payload shape
   - self-notification skip
   - chat notification creation
   - push failure non-fatal behavior
8. Document final config, curl commands, and any remaining manual rollout steps.
