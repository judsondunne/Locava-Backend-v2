# Search Users Discovery (v2)

Date: 2026-04-20

## Native User Result Needs

From native search profile rows:

- `userId`
- `name`
- `handle`
- `profilePic`
- viewer follow indicator (`isFollowing` in UI model)

No user-post payload, no graph payload, no heavy profile payload is required for first render.

## Shared Entity Reuse Decision

`AuthorSummary` is sufficient for user item payload:

- `userId`, `handle`, `name`, `pic`

Follow state is viewer-specific and should be projected separately (not by creating a parallel user entity schema).

## Query-Churn + Pressure Risks

Primary risks:

- rapid query churn causing overlapping requests
- duplicate same-query requests causing repeated work
- stale/out-of-order response application client-side

Route must provide:

- `requestKey`
- `queryEcho`
- cursor echo
- in-flight dedupe
- bounded concurrency
- route cache for identical pages

## What Search Users Must Exclude

- post lists under users
- follower/following graph blobs
- profile detail sections
- heavy social/ranking debug payloads

## Mutation Consistency Requirement

`follow` / `unfollow` mutations should be reflected through viewer follow-state projection for returned user IDs.

This requires:

- reading current follow state in user-search read path
- ensuring mutation invalidation for `user:{userId}:summary` remains compatible with user-search cache rebuild

## Route Decision

Implement isolated route:

- `GET /v2/search/users?q=...&cursor=...&limit=...`

Do not merge with post search route.
