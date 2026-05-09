# Field test session logging (Cloud Run / Cloud Logging)

Enable client telemetry ingest on Backendv2 (Cloud Run), then start **Field Test** on the Locava native app. Every Backendv2 request can send `x-locava-field-test-session-id`; completion logs include `fieldTestSessionId` when that header is set.

## Environment (Cloud Run)

Set at least one of:

- `ENABLE_CLIENT_DEBUG_LOG_INGEST=1` — enables structured `FIELD_TEST_CLIENT_EVENT` logs from `/debug/client-telemetry/events` (and matches existing client debug ingest gate).
- `ENABLE_CLIENT_TELEMETRY_INGEST=1` — enables the telemetry HTTP route in production (same as prior explicit telemetry flag).
- `FIELD_TEST_LOGGING_ENABLED=1` — optional; also turns on structured field-test client logs.

If `fieldTestSessionId` is absent, request logging stays the same as before (no extra client-only structured lines).

## Logs Explorer filter

```
resource.type="cloud_run_revision"
resource.labels.service_name="<SERVICE_NAME>"
jsonPayload.fieldTestSessionId="<SESSION_ID>"
```

Replace `<SERVICE_NAME>` with your Cloud Run service name and `<SESSION_ID>` with the value shown in the app (for example `fieldtest-1715…-abc123`).

## Live tail (`gcloud`)

```bash
gcloud alpha logging tail \
'resource.type="cloud_run_revision"
 AND resource.labels.service_name="<SERVICE_NAME>"
 AND jsonPayload.fieldTestSessionId="<SESSION_ID>"' \
--project=<PROJECT_ID>
```

## Firestore

Field test logging uses **Cloud Logging only**. No Firestore writes are used for these diagnostics.
