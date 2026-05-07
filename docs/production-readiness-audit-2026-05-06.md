# Production Readiness Audit - 2026-05-06

Source evidence is from latest production/profile phone logs supplied in this audit request plus current Backendv2 replay artifacts.

## 1) Auth / Session
- Routes: `GET /v2/auth/session`, `POST /v2/auth/push-token`
- Evidence: cached auth observed `0.63-6ms`; push-token fast; telemetry missing on some calls.
- Telemetry coverage: **WARN** (partial null client headers seen)
- Status: **WARN**
- Action required: enforce Native wrapper usage for all auth/session/push-token calls.
- Verification: header coverage tests + readiness harness auth row.

## 2) Home / For You Feed
- Routes: `GET /v2/feed/for-you/simple?limit=5`
- Evidence: latest production/profile phone log `latencyMs=2941.93`, `payloadBytes=316458`, `reads=330`, `queries=13`, budget violations on latency/reads/queries/payload; PHONE_PERF `route.response_received 3009ms`.
- Telemetry coverage: **YES** on main path.
- Status: **FAIL**
- Action required: hard-bound cold refill/fallback candidate scans, remove duplicated canonical payloads from first paint, keep startup video data and initial social counts without requiring details batch, enforce payload/read budget tests.
- Verification: feed harness row + feed payload/read tests.

## 3) Video Playback / Details Batch / Liftable
- Routes: `POST /v2/posts/details:batch`, `GET /v2/posts/:postId/detail`
- Evidence:
  - repeated playback/prefetch details batch calls in one session window
  - observed payloads `115057 bytes / 558.57ms / 8 reads / 6 queries`
  - `173162 bytes / 1014.43ms / 12 reads / 9 queries`
  - cached zero-read responses still `287764 bytes / 26.38ms / 0 reads / 0 queries`
  - cached zero-read responses still `230423 bytes / 14.93ms / 0 reads / 0 queries`
  - Liftable telemetry for post `8BqoHf5RCmZAfjZA5wNm` still reports/selects `asset=legacy_image_1`
- Telemetry coverage: **WARN** (some null route/surface in logs).
- Status: **FAIL**
- Action required: compact playback-prefetch mode and cache keys by mode, dedupe overlapping native requests, and force canonical video asset ids in Liftable telemetry/selection.
- Verification: playback prefetch payload test + native prefetch dedupe test.

## 4) Profile Bootstrap
- Routes: `GET /v2/profiles/:userId/bootstrap?gridLimit=18`
- Evidence:
  - latest production/profile phone log `GET /v2/profiles/:id/bootstrap?gridLimit=12`
  - `latencyMs=899.09`, `payloadBytes=1169024`, `reads=46`, `queries=7`
  - other-user bootstrap observed `503 source_of_truth_required` for `8HmvVXR5TAaB7hBaLJ9UYY1Cs722` and `PYEY96qCc2erkFkwv0o4CnVqOjI3`
- Telemetry coverage: **WARN**
- Status: **FAIL**
- Action required: staged compact bootstrap (header + compact preview only) with graceful fallback for valid other-user profiles instead of `503`.
- Verification: bootstrap payload budget test + grid continuation route test.

## 5) Followers / Following
- Routes: `GET /v2/profiles/:userId/followers`, `GET /v2/profiles/:userId/following`
- Evidence: followers `503 source_of_truth_required:profile_followers_firestore_unavailable`; following cold `1573.01ms`, `reads=270`, `queries=2`.
- Telemetry coverage: **WARN**
- Status: **FAIL**
- Action required: followers source-of-truth availability fix/degrade path, reduce initial following page size and read fanout.
- Verification: route 200/no-503 tests + pagination/read budget tests.

## 6) Suggested Friends / Social Discovery
- Routes: `GET /v2/social/suggested-friends`
- Evidence: groups source `FAILED_PRECONDITION`; onboarding/generic calls `1569-2149ms`, `reads=29-63`, budget violations.
- Telemetry coverage: **WARN**
- Status: **FAIL**
- Action required: index/source hardening, cached compact responses, avoid startup-critical blocking.
- Verification: no FAILED_PRECONDITION in normal path + cached latency budget test.

## 7) Collections
- Routes: `GET /v2/collections?limit=50`
- Evidence: backend sample `4.93ms`, `32531 bytes`, but PHONE_PERF logged `route.response_received GET /v2/collections 200 client=3183ms`.
- Telemetry coverage: **WARN**
- Status: **WARN**
- Action required: verify/fix native route timing so client elapsed reflects fetch timing, not delayed telemetry flush or queued work.
- Verification: harness collection route + existing route tests.

## 8) Search
- Routes: native search bootstrap and directory users routes.
- Evidence: insufficient phone production log coverage in supplied dataset.
- Telemetry coverage: **WARN**
- Status: **WARN**
- Action required: include search routes in readiness harness and enforce headers.
- Verification: harness rows for search bootstrap + directory users.

## 9) Map
- Routes: map bootstrap/markers routes used by native.
- Evidence: insufficient direct phone profile evidence in supplied dataset.
- Telemetry coverage: **WARN**
- Status: **WARN**
- Action required: route-level harness coverage + header coverage.
- Verification: harness rows for map bootstrap + markers.

## 10) Chat
- Routes: `GET /v2/chats/inbox`, thread/messages routes.
- Evidence: insufficient direct phone profile evidence in supplied dataset.
- Telemetry coverage: **WARN**
- Status: **WARN**
- Action required: include inbox/thread routes in harness and assert no 5xx.
- Verification: harness chat rows + route tests.

## 11) Telemetry / Observability
- Routes: all native-triggered Backendv2 routes.
- Evidence: many requests still show null `clientSessionId/clientRequestId/clientRouteName/clientSurface/clientBuildProfile/clientPlatform`.
- Telemetry coverage: **FAIL**
- Status: **FAIL**
- Action required: route all native calls through Backendv2 client or shared telemetry header helper.
- Verification: native tests asserting mandatory client headers.

## 12) Background Warmers
- Routes/jobs: near-me quick/full, mixes scheduled refresh.
- Evidence: near-me quick warmer still runs during startup (`targetDocs=1200`, observed ~`7777ms`) while first feed is active; mix refresh still overlaps the same startup window; current feed summary still claims `blockedByStartupWarmers=false`.
- Telemetry coverage: n/a
- Status: **FAIL**
- Action required: stricter first-interactive gating, accurate overlap accounting, and defer/trim quick warmers during P0/P1 traffic.
- Verification: gate tests (defer/resume/no-starvation).

## 13) Logging
- Evidence: `firebase_admin_initialized` still dumps `clientEmail`; `video_processing_cloud_tasks_startup` still emits a giant object; `FeedAppPostMediaIntegrity` still logs per-post spam; `analytics bigquery_publish_fail` still spams normal runs; large feed summary object still logs every request.
- Status: **FAIL**
- Action required: compact request logs, debug-gate noisy diagnostics, hide identity secrets by default, compact expected domain errors.
- Verification: logging tests for default prod-safe output.

## 14) Legacy Compatibility Routes
- Routes: `/api/config/version`, `/api/v1/product/users/multiple`, `/api/v1/product/viewer` and remaining compat paths.
- Evidence: still active in logs, sometimes without telemetry metadata.
- Status: **WARN**
- Action required: keep only required compat routes, ensure metadata + budget visibility, plan migration to v2 equivalents.
- Verification: harness coverage + native call inventory.
