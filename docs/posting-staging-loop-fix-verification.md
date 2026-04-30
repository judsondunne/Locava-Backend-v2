# Posting Staging Loop Verification

## 1) Start Backendv2

```bash
cd "Locava Backendv2"
npm run dev
```

## 2) Reproduce in Native

1. Open Locava Native post flow.
2. Select one video.
3. Wait 10 seconds on the post compose/info flow.

## 3) Expected Backend Behavior

- `POST /v2/posting/staging/presign` should appear at most once for the first stage attempt (or twice if there is a single retry path).
- Repeated duplicate requests with the same `clientStagingKey` should return cached presign rows.
- Diagnostics should show `idempotency.hits > 0` for `posting.stagingpresign.post` when duplicates happen.
- Loop guard should log `posting_staging_presign_loop_guard` if the same key is spammed.

## 4) Finalize Validation

1. Press Share.
2. Confirm finalize succeeds without triggering a new staging presign cycle for the same asset.
3. Confirm created post has the expected video asset and playback works.

## 5) Quick Diagnostics Check

```bash
curl "http://localhost:3000/diagnostics?limit=100"
```

Find `routeName = "posting.stagingpresign.post"` and verify:

- `idempotency.hits` increases when duplicate same-key calls occur.
- request volume is bounded (no hundreds of calls for one asset).
