# Media Upload v2 (Preservation-Compatible First Slice)

Date: 2026-04-20  
Scope: smallest safe v2 media/upload control-plane slice based on legacy upload/media behavior audit.

## What Was Audited in Old Backend

Audited legacy sources included:

- `Locava Backend/src/routes/directPostUpload.routes.ts`
- `Locava Backend/src/routes/v1/product/upload.routes.ts`
- `Locava Backend/src/controllers/directPostUpload.controller.ts`
- `Locava Backend/src/services/wasabi.service.ts`
- `Locava Backend/src/services/cloudTasks.service.ts`

Observed production-critical semantics:

- direct-to-storage upload is primary and should remain primary,
- staged media is session-bound and index-bound,
- finalize is idempotent and should remain fast/non-blocking,
- readiness is a state progression (not immediate upload completion),
- poll/reconcile is expected by native for ambiguous/retry flows.

## Implemented v2 Slice (This Phase)

Control-plane routes only:

- `POST /v2/posting/media/register`
- `POST /v2/posting/media/:mediaId/mark-uploaded`
- `GET /v2/posting/media/:mediaId/status`

This slice intentionally does **not** move binary upload into v2 API routes.

## Preserved Semantics

- Session-bound media registration (`sessionId` + `assetIndex`) to match staged lifecycle.
- Idempotent media registration replay for repeated same intent.
- Idempotent mark-uploaded replay for duplicate completion signals.
- Explicit status polling with `shouldPoll` + `recommendedIntervalMs` to reduce poll storms.
- Non-blocking control-plane behavior (no heavy processing in request path).

## Pressure-Safety Guardrails

- Strict idempotency recording (`idempotency.hits/misses`).
- In-flight dedupe for repeated same media/session operations.
- Concurrency caps:
  - register lane: 10
  - mark-uploaded lane: 10
  - status lane: 16
- Minimal response payloads and explicit route policies.
- No binary request bodies in this slice (`upload.binaryUploadThroughApi=false`).

## Route Policies

- `posting.mediaregister.post` (`critical_interactive`)
  - latency: p50 80ms / p95 180ms
  - dbOps: reads<=4, queries<=3
  - payload: target 3KB, max 9KB
- `posting.mediamarkuploaded.post` (`deferred_interactive`)
  - latency: p50 75ms / p95 170ms
  - dbOps: reads<=2, queries<=2
  - payload: target 2.5KB, max 8KB
- `posting.mediastatus.get` (`deferred_interactive`)
  - latency: p50 65ms / p95 160ms
  - dbOps: reads<=2, queries<=2
  - payload: target 2.5KB, max 8KB

## What Is Intentionally Not Implemented Yet

- binary upload transport in v2 API server,
- presign generation and object-store write orchestration in v2,
- transcode/variant processing migration into v2,
- broad cutover away from legacy upload/media data-plane.

## Compatibility Risks + Mitigations

- Risk: breaking native staging sequence assumptions.
  - Mitigation: keep session/index lifecycle and direct-store pattern.
- Risk: duplicate upload completion storms.
  - Mitigation: idempotent mark-uploaded + dedupe + mutation lock.
- Risk: aggressive status polling.
  - Mitigation: explicit `shouldPoll` and interval hints.

## Test Coverage Added

- `src/routes/v2/posting-media.routes.test.ts`
  - repeated registration idempotency
  - repeated mark-uploaded idempotency
  - bounded status polling to ready
  - diagnostics route policy/idempotency/dedupe visibility

## Curl Verification Commands

Create session first:

```bash
curl -sS -X POST "http://localhost:3000/v2/posting/upload-session" \
  -H "content-type: application/json" \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal" \
  -d '{"clientSessionKey":"media-session-001","mediaCountHint":1}'
```

Register media:

```bash
curl -sS -X POST "http://localhost:3000/v2/posting/media/register" \
  -H "content-type: application/json" \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal" \
  -d '{"sessionId":"<SESSION_ID>","assetIndex":0,"assetType":"video","clientMediaKey":"client-media-001"}'
```

Repeat same registration (idempotent replay):

```bash
curl -sS -X POST "http://localhost:3000/v2/posting/media/register" \
  -H "content-type: application/json" \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal" \
  -d '{"sessionId":"<SESSION_ID>","assetIndex":0,"assetType":"video","clientMediaKey":"client-media-001"}'
```

Mark uploaded:

```bash
curl -sS -X POST "http://localhost:3000/v2/posting/media/<MEDIA_ID>/mark-uploaded" \
  -H "content-type: application/json" \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal" \
  -d '{"uploadedObjectKey":"postSessionStaging/internal-viewer/<SESSION_ID>/0.mp4"}'
```

Repeat mark-uploaded (idempotent replay):

```bash
curl -sS -X POST "http://localhost:3000/v2/posting/media/<MEDIA_ID>/mark-uploaded" \
  -H "content-type: application/json" \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal" \
  -d '{"uploadedObjectKey":"postSessionStaging/internal-viewer/<SESSION_ID>/0.mp4"}'
```

Poll media status:

```bash
curl -sS "http://localhost:3000/v2/posting/media/<MEDIA_ID>/status" \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal"
```

Diagnostics check:

```bash
curl -sS "http://localhost:3000/diagnostics?limit=60"
```

Expected diagnostics fields:

- `routeName`
- `routePolicy`
- `dbOps`
- `payloadBytes`
- `idempotency`
- `dedupe`
- `concurrency`
- `budgetViolations`
