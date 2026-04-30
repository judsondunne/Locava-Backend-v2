# Backend V2 Analytics Restoration Final

Date: 2026-04-30

## What Was Restored

### Backend v2

Added a real analytics pipeline in Backend v2:

- `POST /v2/analytics/events`
- compat alias `POST /api/analytics/v2/events`
- synchronous request validation
- legacy-compatible normalization
- bounded in-memory queue
- async BigQuery publisher
- `202 Accepted` response pattern
- route-level backend observation events emitted from the shared response hook
- local dev debug surfaces for recent accepted/published analytics state

New backend files:

- `src/contracts/surfaces/analytics-events.contract.ts`
- `src/orchestration/surfaces/analytics-events.orchestrator.ts`
- `src/repositories/analytics/analytics-publisher.ts`
- `src/services/analytics/analytics-ingest.service.ts`
- `src/services/analytics/analytics-runtime.ts`
- `src/services/analytics/analytics-route-observer.ts`
- `src/routes/v2/analytics-events.routes.ts`
- `src/routes/v2/analytics-events.routes.test.ts`
- `src/services/analytics/analytics-ingest.service.test.ts`

Updated backend files:

- `src/app/createApp.ts`
- `src/app/fastify.d.ts`
- `src/config/env.ts`
- `src/routes/contracts.ts`
- `src/routes/debug/local-debug.routes.ts`
- `src/routes/compat/launch-compat.routes.ts`
- `src/routes/compat/legacy-api-stubs.routes.ts`

### Native

Kept the existing client queue/session/screen-tracking system and restored the missing v2 integration points instead of replacing it:

- analytics transport now points at `/v2/analytics/events`
- `tab_view` added on real pager tab changes
- `post_like` / `post_unlike` added on successful v2 like mutation completion
- `post_save` / `post_unsave` added on successful v2 save mutation completion
- `comment_create` added on successful v2 comment creation
- `follow` / `unfollow` added on successful v2 follow mutations
- `chat_opened` added for embedded and overlay chat opens
- client dedupe helper extracted and tested so `screen_view` and `session_start` spam protection remains explicit

New native files:

- `src/analytics/analyticsClientDedupe.ts`
- `src/analytics/analyticsClientDedupe.test.ts`
- `src/analytics/nativeAnalyticsWiring.test.ts`

Updated native files:

- `src/analytics/analyticsFetch.ts`
- `src/analytics/enhancedTrackingService.ts`
- `src/nav/TabHost.tsx`
- `src/features/liftable/backendv2/viewerMutationsV2.owner.ts`
- `src/data/repos/connectionsRepo.ts`
- `src/features/chats/chatsModal.store.ts`

## Old-to-New Behavior Mapping

- Old client batch POST `/api/analytics/v2/events`
  - New Backend v2 accepts both `/v2/analytics/events` and `/api/analytics/v2/events`
- Old legacy backend wrote BigQuery `client_events`
  - New Backend v2 writes the same row shape
- Old client delayed analytics until after interactions/home warm-up
  - Current Native still preserves that startup gate behavior
- Old backend returned `202` and published later
  - New Backend v2 returns `202` and publishes from an internal queue
- Old dedupe keyed by `eventId`
  - New Backend v2 dedupes by `eventId`

## Event List

Validated/known event contract support now includes:

- `session_start`
- `session_heartbeat`
- `session_end`
- `session_location`
- `app_open`
- `app_first_open`
- `app_foreground`
- `app_background`
- `screen_view`
- `tab_view`
- `feed_bootstrap`
- `feed_page_view`
- `post_impression`
- `post_open`
- `post_view`
- `post_view_duration`
- `post_like`
- `post_unlike`
- `post_save`
- `post_unsave`
- `comment_open`
- `comment_create`
- `profile_view`
- `map_open`
- `map_marker_view`
- `search_open`
- `search_query`
- `search_result_click`
- `collection_view`
- `collection_save`
- `chat_opened`
- `notification_opened`
- `onboarding_step_view`
- `onboarding_step_complete`
- `deep_link_open`
- `user_identified`
- `consent_updated`
- `feature_flag_state`
- `experiment_exposure`
- `post_engagement_summary_v1`
- `backend_route_observation`

Unknown snake_case legacy events are still accepted so older helper emitters like `achievement_*`, `post_flow_*`, `trip_*`, and `mix_*` do not get broken by the restoration.

## Payload Schema

### Accepted client envelope

Supported top-level fields:

- `eventId`
- `schemaVersion`
- `event`
- `properties`
- `clientTime`
- `serverTime`
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
- `country`
- `region`
- `geohashPrecision`
- `attribution`
- `branch_link_data_first`
- `branch_link_data_last`
- `consentFlags`
- `experimentExposures`
- `networkType`
- `screenName`
- `performance`

### BigQuery row compatibility

Published row shape matches the old dashboard contract:

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

Compatibility notes:

- `properties` remains JSON
- `installId` is preserved inside `properties.installId`
- attribution and Branch data are preserved inside `properties`
- old event names are preserved where known

## Native Integration Notes

- Native session lifecycle, heartbeat cadence, startup deferral, screen tracking, background flush behavior, and AsyncStorage queue all remain in the existing `enhancedTrackingService` implementation.
- The restoration intentionally did not move analytics work into feed/search/map/profile bootstrap requests.
- The newly added v2 action events are emitted only after successful mutations/open actions, not during render.

## Performance Guarantees

- Product routes do not await BigQuery.
- Analytics accept path validates and enqueues only.
- Backend route observations are emitted from the shared response hook, not from business handlers.
- No extra Firestore reads were added for analytics.
- Queue size is bounded by env config.
- Retry count and retry backoff are bounded by env config.
- Local/dev can disable analytics via `ANALYTICS_ENABLED=false`.
- BigQuery failures do not fail product responses.

## Local Verification Tools

Debug-only local endpoints added under local dev identity mode:

- `GET /debug/local/analytics/events`
  - shows recent accepted, published, failed, and queued analytics state
- `POST /debug/local/analytics/test-publish`
  - enqueues a probe event and returns the current snapshot

## Tests Run

Backend:

- `npx vitest run src/services/analytics/analytics-ingest.service.test.ts src/routes/v2/analytics-events.routes.test.ts`

Native:

- `npx --yes tsx src/analytics/analyticsClientDedupe.test.ts`
- `npx --yes tsx src/analytics/nativeAnalyticsWiring.test.ts`
- `npx --yes tsx src/analytics/analyticsStartupGate.test.ts`
- `npm run check:syntax`

Additional note:

- Full Backend v2 `npm run typecheck` is not currently green because the repo already contains many unrelated pre-existing TypeScript failures outside this change set.
- `src/app/createApp.test.ts` also currently depends on a deterministic Firestore test mode setup and was not usable as a clean validation target for this slice without broader harness cleanup.

## Remaining Manual Dashboard Verification

1. Start Backend v2 with valid BigQuery credentials and `ANALYTICS_ENABLED=true`.
2. Use Native with Backend v2 enabled and perform:
   - cold open
   - tab switches
   - feed open
   - post like/save
   - comment create
   - follow/unfollow
   - chat open
3. Confirm `GET /debug/local/analytics/events` shows accepted and published items locally.
4. Confirm BigQuery rows land in:
   - dataset `ANALYTICS_DATASET`
   - table `ANALYTICS_EVENTS_TABLE`
5. Validate dashboard rows for:
   - `session_start`
   - `screen_view`
   - `tab_view`
   - `post_like`
   - `post_save`
   - `comment_create`
   - `follow`
   - `chat_opened`
6. Validate legacy dashboards still read expected fields from `properties`.

