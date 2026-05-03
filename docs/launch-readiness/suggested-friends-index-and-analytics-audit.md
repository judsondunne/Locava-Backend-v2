# Suggested Friends Index and Analytics Audit

## 1) Suggested Friends Finding

- Exact failing query path:
  - `src/repositories/surfaces/suggested-friends.repository.ts`
  - Groups source executes:
    - `collectionGroup("members").where("userId", "==", viewerId).limit(8)`
  - Failure log source:
    - `[suggested-friends] source query failed (summarized)` with `source: "groups"` and `errorCode: "FAILED_PRECONDITION"`.
- Root cause determination:
  - Query shape is valid (no invalid `FieldPath.documentId()` usage and no collectionGroup/documentId mismatch in this code path).
  - This is consistent with a missing or not-yet-deployed collection group index in the target Firestore project (or index still building).
- Development-safe logging improvement:
  - In non-production only, the log now includes:
    - full Firestore error message
    - parsed Firebase Console index URL when Firestore provides one
  - Production remains summarized/throttled (no log spam, no secrets).
- Firebase Console index instructions (if missing in project):
  - Collection ID: `members`
  - Scope: `Collection group`
  - Field 1: `userId` — Ascending
  - Field 2: `__name__` — Ascending
  - Field 3: none
- `firestore.indexes.json` entry:

```json
{
  "collectionGroup": "members",
  "queryScope": "COLLECTION_GROUP",
  "fields": [
    { "fieldPath": "userId", "order": "ASCENDING" },
    { "fieldPath": "__name__", "order": "ASCENDING" }
  ]
}
```

- Launch-safety hardening completed:
  - groups source remains optional; on failure it is skipped and other sources continue
  - if all sources fail, response stays `200` with explicit aggregate diagnostics and empty suggestions (no crash)
  - groups source has failure cooldown after `FAILED_PRECONDITION`
  - service cache TTL increased to 10 minutes (`5-15` minute target satisfied)
  - duplicate requests are singleflighted via existing `dedupeInFlight`
  - route policy set to deferred by default (`P3_DEFERRED_SCREEN`) instead of critical
  - groups source default is now opt-in at call site, reducing app-open exposure
- Files changed:
  - `src/repositories/surfaces/suggested-friends.repository.ts`
  - `src/services/surfaces/suggested-friends.service.ts`
  - `src/routes/v2/social-suggested-friends.routes.ts`
  - `src/observability/route-policies.ts`
  - `src/routes/v2/social.routes.test.ts`
  - `src/services/surfaces/suggested-friends.service.test.ts`
  - `src/observability/route-policies.test.ts`
- Tests added/extended:
  - groups source failure does not fail whole route payload (`social.routes` + repository behavior)
  - route returns `200` with diagnostics when one source fails
  - concurrent duplicate suggestions calls are singleflighted and cached
  - suggested-friends route policy is deferred (`P3`) by default
- Manual app test steps:
  1. Open app normally (home/search bootstrap paths) and verify no startup block from suggested-friends groups query.
  2. Hit `/v2/social/suggested-friends` directly and verify data returns quickly with diagnostics.
  3. Temporarily simulate groups index failure; verify other sources still return and route stays `200`.
  4. Confirm repeated identical requests within 10 minutes hit cache/dedupe.
  5. If Firestore returns index URL in error message, create the index and re-test.

## 2) BigQuery Finding

- Analytics publish code path:
  - `src/routes/v2/analytics-events.routes.ts`
  - `src/orchestration/surfaces/analytics-events.orchestrator.ts`
  - `src/services/analytics/analytics-ingest.service.ts`
  - `src/repositories/analytics/analytics-publisher.ts`
- Runtime identity/config diagnostics added:
  - On first publish attempt, logs:
    - active configured project/dataset/table
    - credential source
    - service account email (if known)
    - enabled flag
    - non-blocking failure behavior
    - exact fix command: `npm run debug:analytics:bigquery`
  - If analytics is disabled/misconfigured by env, logs explicit disabled reason.
  - BigQuery failure logs are now rate-limited and include non-blocking context.
- Diagnostics script added:
  - `scripts/check-bigquery-analytics-access.mts`
  - `npm run debug:analytics:bigquery`
  - Uses same env + runtime config helper as analytics publisher.
  - Checks:
    - config identity
    - dataset existence
    - table existence
    - optional test write when `ANALYTICS_BIGQUERY_TEST_WRITE=1`
  - Emits status:
    - `PASS`
    - `FAIL_MISSING_DATASET`
    - `FAIL_MISSING_TABLE`
    - `FAIL_PERMISSION_DENIED`
    - `FAIL_CONFIG_MISMATCH`
    - `UNKNOWN_ERROR`
- Current run results (`npm run debug:analytics:bigquery` + `ANALYTICS_BIGQUERY_TEST_WRITE=1 npm run debug:analytics:bigquery`):
  - active project: `learn-32d72`
  - dataset: `analytics_prod`
  - table: `client_events`
  - credential source: `google_application_credentials`
  - service account email: `null` (not exposed by current credentials in script output)
  - dataset exists: yes
  - table exists: yes
  - write permission exists: yes (test insert succeeded with `ANALYTICS_BIGQUERY_TEST_WRITE=1`)
- Permission required when failing with prior error:
  - Required permission: `bigquery.tables.updateData` on `learn-32d72:analytics_prod.client_events`
  - Typical fix: grant role including that permission (for example `roles/bigquery.dataEditor` on the dataset/table) to the runtime service account.
- Local vs Cloud Run identity:
  - Local uses ADC (`google_application_credentials`) in this run.
  - Cloud Run may use a different service account identity; mismatch remains a primary candidate when local and deployed behavior differ.
- Files changed:
  - `src/repositories/analytics/analytics-publisher.ts`
  - `scripts/check-bigquery-analytics-access.mts`
  - `package.json`
  - `src/repositories/analytics/analytics-publisher.test.ts`
  - `src/routes/v2/analytics-events.routes.test.ts`
- Tests added/extended:
  - analytics route returns `202` even when publisher later fails
  - BigQuery failure logging includes non-blocking diagnostics + fix command
  - diagnostics config helper test ensures script/runtime config parity
  - existing route test continues proving route does not await publish path
- Manual verification steps:
  1. Run `npm run debug:analytics:bigquery`.
  2. If needed, run `ANALYTICS_BIGQUERY_TEST_WRITE=1 npm run debug:analytics:bigquery` in non-production-safe environment.
  3. Trigger `/api/analytics/v2/events`; confirm immediate `202`.
  4. Confirm BigQuery failures (if any) are non-blocking and rate-limited in logs.
  5. Ensure Cloud Run service account has `bigquery.tables.updateData` on the target table/dataset.

## 3) Final Recommendation

**SAFE TO LAUNCH**

- Suggested-friends path is launch-safe with deferred policy, source isolation, singleflight/cache, and explicit diagnostics.
- Analytics path remains non-blocking and now has actionable identity diagnostics, and local runtime write access has been verified with the explicit test write path.

