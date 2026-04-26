# Final Backend Route Audit (Backendv2)

Date: 2026-04-20  
Scope: Full v2 route inventory classification for final cutover verification.

## Method

- Route inventory source: `src/routes/contracts.ts` and registered v2 routes in `src/app/createApp.ts`.
- Classification axes applied per route:
  - source-backed and strict-safe
  - source-backed with fallback dependency
  - cache-heavy but safe
  - mutation/invalidation-sensitive
  - likely startup/resume hotspot
  - likely scroll/open hotspot
  - likely polling hotspot
  - likely query-churn hotspot

## Full V2 Route Inventory Classification

### Startup/resume fan-in surfaces

1. `GET /v2/auth/session`
   - cache-heavy but safe
   - likely startup/resume hotspot
2. `GET /v2/bootstrap`
   - cache-heavy but safe
   - likely startup/resume hotspot
3. `GET /v2/feed/bootstrap`
   - source-backed and strict-safe
   - source-backed with fallback dependency
   - cache-heavy but safe
   - likely startup/resume hotspot
   - likely scroll/open hotspot
4. `GET /v2/notifications`
   - cache-heavy but safe
   - likely startup/resume hotspot
   - likely polling hotspot
5. `GET /v2/chats/inbox`
   - cache-heavy but safe
   - likely startup/resume hotspot
   - likely polling hotspot
6. `GET /v2/achievements/hero`
   - cache-heavy but safe
   - likely startup/resume hotspot
7. `GET /v2/achievements/snapshot`
   - cache-heavy but safe
   - likely startup/resume hotspot
8. `GET /v2/map/bootstrap`
   - cache-heavy but safe
   - likely startup/resume hotspot

### Feed/profile/search read surfaces

9. `GET /v2/feed/page`
   - source-backed and strict-safe
   - source-backed with fallback dependency
   - cache-heavy but safe
   - likely scroll/open hotspot
10. `GET /v2/feed/items/:postId/detail`
    - source-backed and strict-safe
    - source-backed with fallback dependency
    - cache-heavy but safe
    - likely scroll/open hotspot
11. `GET /v2/profiles/:userId/bootstrap`
    - source-backed and strict-safe
    - source-backed with fallback dependency
    - cache-heavy but safe
    - likely scroll/open hotspot
12. `GET /v2/profiles/:userId/grid`
    - source-backed and strict-safe
    - source-backed with fallback dependency
    - cache-heavy but safe
    - likely scroll/open hotspot
13. `GET /v2/profiles/:userId/posts/:postId/detail`
    - source-backed and strict-safe
    - source-backed with fallback dependency
    - cache-heavy but safe
    - likely scroll/open hotspot
14. `GET /v2/search/results`
    - source-backed and strict-safe
    - source-backed with fallback dependency
    - cache-heavy but safe
    - likely query-churn hotspot
15. `GET /v2/search/users`
    - source-backed and strict-safe
    - source-backed with fallback dependency
    - cache-heavy but safe
    - likely query-churn hotspot
16. `GET /v2/directory/users`
    - cache-heavy but safe
    - likely query-churn hotspot

### Mutation + invalidation-sensitive surfaces

17. `POST /v2/posts/:postId/like`
    - mutation/invalidation-sensitive
18. `POST /v2/posts/:postId/unlike`
    - mutation/invalidation-sensitive
19. `POST /v2/posts/:postId/save`
    - mutation/invalidation-sensitive
20. `POST /v2/posts/:postId/unsave`
    - mutation/invalidation-sensitive
21. `POST /v2/users/:userId/follow`
    - mutation/invalidation-sensitive
22. `POST /v2/users/:userId/unfollow`
    - mutation/invalidation-sensitive
23. `GET /v2/posts/:postId/comments`
    - cache-heavy but safe
    - likely scroll/open hotspot
24. `POST /v2/posts/:postId/comments`
    - mutation/invalidation-sensitive
25. `DELETE /v2/comments/:commentId`
    - mutation/invalidation-sensitive
26. `POST /v2/notifications/mark-read`
    - mutation/invalidation-sensitive
27. `POST /v2/notifications/mark-all-read`
    - mutation/invalidation-sensitive
28. `GET /v2/chats/:conversationId/messages`
    - cache-heavy but safe
    - likely scroll/open hotspot
    - likely polling hotspot
29. `POST /v2/chats/:conversationId/messages`
    - mutation/invalidation-sensitive
30. `POST /v2/chats/:conversationId/mark-read`
    - mutation/invalidation-sensitive
31. `GET /v2/collections/saved`
    - cache-heavy but safe
    - likely scroll/open hotspot
    - likely polling hotspot
32. `GET /v2/achievements/pending-delta`
    - cache-heavy but safe
    - likely polling hotspot

### Posting control-plane/media control-plane

33. `POST /v2/posting/upload-session`
    - mutation/invalidation-sensitive
34. `POST /v2/posting/media/register`
    - mutation/invalidation-sensitive
35. `POST /v2/posting/media/:mediaId/mark-uploaded`
    - mutation/invalidation-sensitive
36. `POST /v2/posting/finalize`
    - mutation/invalidation-sensitive
37. `GET /v2/posting/media/:mediaId/status`
    - likely polling hotspot
    - cache-heavy but safe
38. `GET /v2/posting/operations/:operationId`
    - likely polling hotspot
    - cache-heavy but safe
39. `POST /v2/posting/operations/:operationId/cancel`
    - mutation/invalidation-sensitive
40. `POST /v2/posting/operations/:operationId/retry`
    - mutation/invalidation-sensitive

## High-Risk Overlap Clusters

1. Startup fan-in overlap:
   - `auth/session`, `bootstrap`, `feed/bootstrap`, `notifications`, `chats/inbox`, `achievements/*`, `map/bootstrap`.
2. Feed interaction burst overlap:
   - `feed/page`, `feed/detail`, `like/save/comment`, `collections/saved`, `notifications`.
3. Posting + read-refresh overlap:
   - `posting/*` status polling plus `feed/profile/comments/notifications` reads.
4. Chat burst overlap:
   - `chats/inbox`, `chats/thread`, `chats/send`, `chats/mark-read`.
5. Search churn overlap:
   - `search/results`, `search/users`, `directory/users` under rapid query changes.

## Final Route-Audit Takeaways

- All shipped v2 surfaces are represented and mapped to realistic pressure archetypes.
- Strict-safe source enforcement exists for parity-critical source-backed read routes.
- Residual risk is not missing routes; it is overlapping route pressure (startup fan-in, polling cadence, and query churn) plus coherence behavior in horizontally scaled deployments.
