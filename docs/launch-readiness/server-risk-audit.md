# Server Risk Audit

Generated: 2026-05-02T16:27:11.898Z

| Finding | Classification | Surface | Route | Risk | Notes |
| --- | --- | --- | --- | --- | --- |
| auth-session | BROKEN_LATENCY_BUDGET | Auth/session/bootstrap | `auth.session.get` | FAIL | n/a |
| feed-item-detail | BROKEN_FAKE_FALLBACK | Liftable/feed item hydration | `feed.itemdetail.get` | FAIL | Route is expected to return staged hydration rather than a single fully expanded payload. |
| post-detail | BROKEN_FAKE_FALLBACK | Post detail / liftable canonical detail | `posts.detail.get` | FAIL | Route is expected to return staged hydration rather than a single fully expanded payload. |
| profile-bootstrap | BROKEN_READ_BUDGET | Profile bootstrap | `profile.bootstrap.get` | FAIL | Route is expected to return staged hydration rather than a single fully expanded payload.; Surface timings: profile_bootstrap_achievements_preview_ms=285.11ms, profile_bootstrap_grid_preview_ms=89.12ms, profile_bootstrap_collections_preview_ms=71.69ms, profile_bootstrap_header_ms=2.41ms, profile_bootstrap_relationship_ms=2.32ms |
| search-results | BROKEN_PAYLOAD_BUDGET | Search results posts/collections/places/mixes | `search.results.get` | FAIL | n/a |
| users-unfollow | BROKEN_LATENCY_BUDGET | Unfollow user | `users.unfollow.post` | FAIL | Surface timings: user_unfollow_mutation_ms=237.99ms, user_unfollow_delete_write_ms=237.87ms |
| social-suggested-friends | BROKEN_LATENCY_BUDGET | Suggested friends / contacts | `social.suggested_friends.get` | FAIL | n/a |
| map-bootstrap | BROKEN_PAYLOAD_BUDGET | Map bootstrap | `map.bootstrap.get` | FAIL | Route is expected to return staged hydration rather than a single fully expanded payload. |
| collections-detail | BROKEN_FAKE_FALLBACK | Collection detail | `collections.detail.get` | FAIL | n/a |
| comments-list | BROKEN_READ_BUDGET | Comments list | `comments.list.get` | FAIL | n/a |
| notifications-list | BROKEN_FAKE_FALLBACK | Notifications list | `notifications.list.get` | FAIL | Surface timings: notifications_user_batch_ms=96.79ms, notifications_firestore_parallel_ms=90.55ms, notifications_map_ms=0.1ms |
| chats-create-group | BROKEN_CONTRACT | Create group chat | `/v2/chats/create-group` | FAIL | No route policy metadata found for resolved routeName. |
| chats-delete-message | BROKEN_LATENCY_BUDGET | Chat delete message | `chats.message.delete` | FAIL | n/a |
| chats-delete | MISSING_TEST | Delete chat | `n/a` | WARN | Prerequisite entity discovery did not yield a usable id. |
| posts-detail-batch | BROKEN_FAKE_FALLBACK | Posts detail batch | `posts.detail.batch` | FAIL | n/a |
| posts-like | BROKEN_LATENCY_BUDGET | Post like | `posts.like.post` | FAIL | n/a |
| posting-finalize | BROKEN_LATENCY_BUDGET | Posting finalize | `posting.finalize.post` | FAIL | n/a |
