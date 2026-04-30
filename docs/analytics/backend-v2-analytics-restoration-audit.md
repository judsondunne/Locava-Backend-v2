# Backend V2 Analytics Restoration Audit

Date: 2026-04-30

## Scope

Goal: restore production analytics/session tracking for the current Native app when it is pointed at Backend v2, using the last known-good Native implementation at commit `083cd365224d131397c3d9315950696d4e87cf22` as the behavioral source of truth, while preserving Backend v2 route architecture and keeping analytics off critical render paths.

## Old Behavior Summary

### Old Native source of truth

Primary files reviewed from `Locava-Native@083cd365224d131397c3d9315950696d4e87cf22`:

- `src/analytics/enhancedTrackingService.ts`
- `src/analytics/analyticsFetch.ts`
- `src/analytics/AnalyticsBootstrap.tsx`
- `src/analytics/useScreenAnalytics.ts`
- `src/engagement/postEngagement.tracker.ts`
- `src/features/achievements/analytics/achievements.analytics.ts`
- `src/features/post/upload/postFlowAnalytics.ts`
- `src/features/post/tripsFlowAnalytics.ts`
- `src/features/deepLinking/DeepLinkBridge.tsx`
- `src/recommendation/recommendationEvents.ts`

Observed old behavior:

- Client analytics were batched in AsyncStorage and flushed later, not inline with first paint.
- Batch tuning in the old client:
  - `BATCH_SIZE=50`
  - `MAX_QUEUE_SIZE=500`
  - `BATCH_INTERVAL=480000`
- Startup/network protection already existed:
  - `InteractionManager.runAfterInteractions`
  - extra startup delay
  - home warm-ready gate before analytics HTTP
- Session lifecycle:
  - `session_start` when a session is created
  - `session_end` on background/timeout
  - `session_heartbeat` every 120s when active
  - inactivity threshold `30m`
  - background end threshold `10m`
  - foreground duration accumulation via `AppState`
- Screen tracking:
  - `useScreenAnalytics` emitted `screen_view`
  - blur/focus duration was attached as `durationMs`
  - duplicate re-renders were intentionally avoided
- Client dedupe:
  - 2s dedupe window for `post_creation_start`, `app_open`, `session_start`, `screen_view`
- Transport:
  - events were posted to `/api/analytics/v2/events`
  - auth token was attached when available
  - anonymous fallback was allowed
- Old client also throttled noisy events such as `map_pan`, `map_zoom`, `feed_scroll`, and several video events.

### Old backend ingest pipeline

Primary files reviewed from the legacy backend:

- `src/routes/analyticsIngest.routes.ts`
- `src/controllers/analyticsIngest.controller.ts`
- `src/services/analytics/eventSchemaValidator.ts`
- `src/services/analytics/bigqueryWriter.ts`
- `src/services/analytics/pubsubPublisher.ts`
- `src/services/analytics/propertySanitizer.ts`
- `src/services/analytics/dedupe.service.ts`
- `src/services/analytics/recentSessionsRedis.service.ts`
- `src/services/analytics/lastSeen.service.ts`
- `src/services/analytics/serverAnalytics.ts`
- `docs/analytics/canonical_events_v1.md`
- `.secrets/client_events_schema.json`

Observed old backend behavior:

- Accepted batched client events at `/api/analytics/v2/events`
- Returned `202` on accepted batches
- Normalized/fixed legacy gaps like missing `eventId`, `installId`, `userId`
- Dedupe was based on `eventId`
- BigQuery-compatible row shape was:
  - `event`
  - `schemaVersion`
  - `userId`
  - `anonId`
  - `sessionId`
  - `clientTime`
  - `receivedAt`
  - `platform`
  - `requestIp`
  - `userAgent`
  - `properties`
  - `ingestId`
  - `eventId`
- Dashboard compatibility depended on preserving old event names and the `properties` JSON payload pattern.

## Exact Event Names Found

Directly found in old/current Native analytics code or legacy analytics docs:

- `session_start`
- `session_end`
- `session_heartbeat`
- `session_location`
- `app_open`
- `app_first_open`
- `app_foreground`
- `app_background`
- `deep_link_open`
- `notification_opened`
- `screen_view`
- `user_identified`
- `consent_updated`
- `feature_flag_state`
- `experiment_exposure`
- `post_engagement_summary_v1`
- `post_like`
- `post_unlike`
- `post_save`
- `post_unsave`
- `comment_create`
- `profile_view`
- `search_query`
- `collection_view`
- `chat_opened`
- `onboarding_step_view`
- `onboarding_step_complete`
- achievement-specific `achievement_*`
- post flow `post_flow_*`
- trips flow `trip_*` / `trips_*`
- mixes/search recommendation events such as `mix_*`

## Exact Payload Shapes Found

### Generic client envelope

Common top-level fields found in `enhancedTrackingService.ts`:

- `eventId`
- `schemaVersion`
- `event`
- `properties`
- `clientTime`
- `timezone`
- `userId`
- `anonId`
- `installId`
- `sessionId`
- `appVersion`
- `buildNumber`
- `releaseChannel`
- `platform`
- `osVersion`
- `deviceModel`
- `consentFlags`
- optional `attribution`
- optional `branch_link_data_first`
- optional `branch_link_data_last`
- optional `experimentExposures`
- optional `country`
- optional `region`
- optional `geohashPrecision`

### Representative event property shapes

- `screen_view`
  - `screenName`
  - `durationMs`
  - `endReason`
- `session_start`
  - `sessionId`
  - optional attribution/location context
- `session_end`
  - `sessionId`
  - `duration`
  - `eventsCount`
  - `foregroundMs`
  - `endReason`
- `session_heartbeat`
  - `sessionId`
  - `foregroundMs`
  - optional `final`
- `app_open`
  - `source`
  - `previousSessionGapMs`
- `notification_opened`
  - `notificationId`
  - `type`
  - `ctaType`
  - `postId`
  - `chatId`
  - `senderUserId`
  - `collectionId`
  - `title`
  - `body`
- `post_engagement_summary_v1`
  - `postId`
  - `sessionInstanceId`
  - `surface`
  - `parentSessionId`
  - `feedImpressionMs`
  - `impressionCountDelta`
  - `repeatExposureIndex`
  - `opened`
  - `dwellMs`
  - `reopenCount`
  - `deepInteractionCount`
  - `videoDurationMs`
  - `watchMs`
  - `maxProgressRatio`
  - quartile booleans
  - `playCount`
  - `completed`
  - `pausedCount`
  - `visitNowTaps`
  - `shareTaps`
  - `saveTaps`
  - `commentTaps`
  - `likeTaps`
  - `followFromPost`
  - `bounce`
  - `fastSkipMs`

## Current Backend V2 Summary Before Restoration

Primary current Backend v2 files reviewed:

- `src/app/createApp.ts`
- `src/app/createApp.test.ts`
- `src/routes/compat/launch-compat.routes.ts`
- `src/routes/compat/legacy-api-stubs.routes.ts`
- `src/routes/contracts.ts`
- `src/routes/debug/local-debug.routes.ts`
- `src/routes/system.routes.ts`
- `src/observability/request-context.ts`
- `src/observability/diagnostics-store.ts`
- `src/observability/route-policies.ts`
- `src/auth/viewer-context.ts`

Observed current behavior before restoration:

- `/api/analytics/v2/events` existed only as a stub returning success-like `202`
- no BigQuery publisher existed in Backend v2
- no analytics queue existed in Backend v2
- no route-level backend analytics publishing existed in Backend v2
- request observability already existed and already captured:
  - `routeName`
  - `payloadBytes`
  - `dbOps`
  - `latencyMs`
  - fallback/timeout counts
  - orchestration metadata

Root cause of missing dashboard data:

- Native was still generating analytics events
- Backend v2 accepted the request shape
- Backend v2 never forwarded those events anywhere
- the dashboard therefore saw no new rows

## What Was Missing

- Real analytics ingest endpoint in Backend v2
- Validation + normalization for client analytics batches
- Async queue/publisher between request accept and BigQuery write
- BigQuery row mapping compatible with the old dashboard
- Safe local/dev inspection path for accepted events
- Route-level backend observations emitted from the shared request lifecycle
- Several missing Native action events that were not being emitted from current v2 paths:
  - `tab_view`
  - `post_like`
  - `post_unlike`
  - `post_save`
  - `post_unsave`
  - `comment_create`
  - `follow`
  - `unfollow`
  - `chat_opened`

## What Must Be Restored

- Batch ingest through Backend v2
- Old event naming compatibility where known
- Session lifecycle semantics
- Screen tracking semantics
- BigQuery row compatibility with the old `client_events` schema
- Non-blocking publishing
- Safe failure isolation from product UX
- Cheap backend route observations through shared hooks only

## What Should Not Be Restored

Do not restore these legacy patterns directly into critical product request paths:

- Inline BigQuery writes from product handlers
- Extra Firestore reads whose only purpose is analytics
- Route-specific analytics side effects embedded in business logic
- Unbounded queue growth
- Unbounded retry storms
- Per-render analytics emission from React surfaces
- Noisy high-frequency events like old `map_pan`, `map_zoom`, `feed_scroll` in a first pass

## Recommended Backend V2 Architecture

Target architecture:

- routes
  - `POST /v2/analytics/events`
  - compat alias `POST /api/analytics/v2/events`
- contracts
  - validate batched analytics envelopes
- orchestration
  - hand off accepted payloads to an ingest service
- services
  - normalize payloads
  - dedupe by `eventId`
  - bound queue size
  - retry with backoff
  - expose local debug snapshot
- repositories/publishers
  - BigQuery publisher that writes legacy-compatible rows
- observability
  - emit cheap backend route observation events from shared response hooks

Performance guardrails:

- validate synchronously
- enqueue quickly
- return `202`
- publish asynchronously
- never await BigQuery in product handlers
- drop safely when disabled or queue-bounded

