# Locava Backend V2 Surface Migration Plan

## Goal

Rebuild backend capabilities surface-by-surface while the old backend remains production source of truth until each v2 surface is proven with observability, budgets, and rollout controls.

## Surface Map

### 1) Auth

- Purpose: identity/session verification and lightweight viewer context.
- First-render needs: session validity, viewer id, basic permissions/feature gates.
- Deferred needs: secondary profile fields, non-critical settings.
- Background-only: security telemetry enrichment.
- Current dependency assumptions: auth/session store, user profile root doc.
- Entities: `viewerSession`, `user`.
- Likely v2 endpoints: `GET /v2/auth/session`, `POST /v2/auth/refresh`.
- Latency budget: p50 <= 80ms, p95 <= 180ms.
- Read budget: <= 2 reads/request typical.
- Migration priority: P0.

### 2) Session/Bootstrap

- Purpose: first app payload that unblocks shell rendering.
- First-render needs: viewer summary, core feature flags, minimal counters, initial route context.
- Deferred needs: secondary nav badges, recommendations.
- Background-only: prefetch hints and warmups.
- Current dependency assumptions: user doc, settings doc, lightweight aggregates.
- Entities: `viewer`, `viewerSettings`, `badgeCounters`.
- Likely v2 endpoints: `GET /v2/bootstrap`.
- Latency budget: p50 <= 120ms, p95 <= 280ms.
- Read budget: <= 6 reads/request.
- Migration priority: P0.

### 3) Home Feed

- Purpose: initial feed page and pagination path.
- First-render needs: first page IDs + minimal card payload.
- Deferred needs: social proofs, heavy enrichments.
- Background-only: ranking experiments, deeper recommendations.
- Current dependency assumptions: feed index, post entities, author entities.
- Entities: `feedList`, `post`, `author`, `engagementSummary`.
- Likely v2 endpoints: `GET /v2/feed/home`, `GET /v2/feed/home/next`.
- Latency budget: p50 <= 180ms, p95 <= 450ms.
- Read budget: <= 20 reads first page including joins.
- Migration priority: P1.

### 4) Post Viewer

- Purpose: post detail page and interaction bootstrap.
- First-render needs: post core payload, author summary, immediate interaction state.
- Deferred needs: related posts, deep comments metadata.
- Background-only: recommendation and analytics enrichment.
- Current dependency assumptions: post doc, author doc, reaction state.
- Entities: `post`, `author`, `viewerPostState`.
- Likely v2 endpoints: `GET /v2/posts/:postId/viewer`.
- Latency budget: p50 <= 140ms, p95 <= 320ms.
- Read budget: <= 10 reads/request.
- Migration priority: P1.

### 5) Profile

- Purpose: profile shell and first media grid bootstrap.
- First-render needs: profile header, follow state, first grid page IDs.
- Deferred needs: deeper stats history, secondary tabs.
- Background-only: recommendation/graph enrichment.
- Current dependency assumptions: user doc, profile stats, media index.
- Entities: `user`, `profileStats`, `profilePostsIndex`.
- Likely v2 endpoints: `GET /v2/profiles/:userId/bootstrap`, `GET /v2/profiles/:userId/posts`.
- Latency budget: p50 <= 160ms, p95 <= 380ms.
- Read budget: <= 14 reads/request.
- Migration priority: P1.

### 6) Search

- Purpose: search suggestions/results bootstrap and pagination.
- First-render needs: query suggestions + first result page.
- Deferred needs: enriched ranking explanations.
- Background-only: indexing signals, spelling/ranking experiments.
- Current dependency assumptions: search index, user/post lookup.
- Entities: `searchIndex`, `user`, `post`.
- Likely v2 endpoints: `GET /v2/search/bootstrap`, `GET /v2/search/results`.
- Latency budget: p50 <= 170ms, p95 <= 400ms.
- Read budget: <= 18 reads/request.
- Migration priority: P2.

### 7) Notifications

- Purpose: notification list and unread counters.
- First-render needs: first notification page + unread count.
- Deferred needs: deep actor enrichment.
- Background-only: dedupe/aggregation jobs.
- Current dependency assumptions: notification fanout list, actor lookups.
- Entities: `notifications`, `notificationCounters`, `actors`.
- Likely v2 endpoints: `GET /v2/notifications/bootstrap`, `GET /v2/notifications/next`.
- Latency budget: p50 <= 150ms, p95 <= 350ms.
- Read budget: <= 16 reads/request.
- Migration priority: P2.

### 8) Chat/Inbox

- Purpose: thread list bootstrap and active thread summary.
- First-render needs: thread list + unread/thread metadata.
- Deferred needs: heavy participant enrichments.
- Background-only: typing/presence and sync prefetch.
- Current dependency assumptions: thread index, message snapshots.
- Entities: `threads`, `messages`, `participants`.
- Likely v2 endpoints: `GET /v2/chat/inbox/bootstrap`, `GET /v2/chat/threads/:id/messages`.
- Latency budget: p50 <= 180ms, p95 <= 450ms.
- Read budget: <= 24 reads/request.
- Migration priority: P3.

### 9) Collections

- Purpose: saved/curated list views.
- First-render needs: collection header + first saved item page.
- Deferred needs: collaborator/activity details.
- Background-only: ranking and stale pruning.
- Current dependency assumptions: collection docs, item references.
- Entities: `collection`, `collectionItems`, `post`.
- Likely v2 endpoints: `GET /v2/collections/:id/bootstrap`, `GET /v2/collections/:id/items`.
- Latency budget: p50 <= 170ms, p95 <= 400ms.
- Read budget: <= 18 reads/request.
- Migration priority: P3.

### 10) Groups

- Purpose: group shell, member summary, feed bootstrap.
- First-render needs: group metadata + first feed page IDs.
- Deferred needs: moderation queues and secondary tabs.
- Background-only: recommendation/health metrics.
- Current dependency assumptions: group doc, membership index, group feed index.
- Entities: `group`, `groupMember`, `groupFeed`.
- Likely v2 endpoints: `GET /v2/groups/:groupId/bootstrap`, `GET /v2/groups/:groupId/feed`.
- Latency budget: p50 <= 190ms, p95 <= 480ms.
- Read budget: <= 22 reads/request.
- Migration priority: P3.

### 11) Posting/Upload Pipeline

- Purpose: mutation orchestration for create/edit/publish.
- First-render needs: upload session init and policy.
- Deferred needs: post-processing status details.
- Background-only: media processing and distribution fanout.
- Current dependency assumptions: upload session, draft doc, media jobs.
- Entities: `uploadSession`, `draftPost`, `publishJob`.
- Likely v2 endpoints: `POST /v2/posting/upload-session`, `POST /v2/posting/publish`, `GET /v2/posting/status/:jobId`.
- Latency budget: p50 <= 200ms, p95 <= 500ms for initiation.
- Read budget: <= 12 reads initiation path.
- Migration priority: P4.

## Recommended Migration Sequence

1. Auth + Session/Bootstrap (unlock global route cutover framework)
2. Profile bootstrap
3. Home feed bootstrap
4. Post viewer bootstrap
5. Search bootstrap
6. Notifications
7. Chat/Inbox
8. Collections/Groups
9. Posting/Upload mutations

## Rollout Pattern per Surface

- Build v2 contract + route + orchestrator + repo boundary.
- Define explicit latency/read budgets and cache ownership.
- Add diagnostics route views + curl script examples.
- Deploy disabled by default.
- Enable by feature flag for internal test traffic.
- Compare old vs v2 latency/read/error trends.
- Expand traffic only after budget stability and fallback correctness.
