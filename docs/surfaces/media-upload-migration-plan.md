# Media Upload Migration Plan (Compatibility-First)

Date: 2026-04-20  
Goal: preserve production-critical legacy media semantics while introducing smallest safe v2 media slice.

## Preservation Classification

## A) Preserve Exactly (No Semantic Drift)

- Direct-to-storage primary pattern (presign/direct upload first).
- Session-bound staged asset model (`sessionId`, `assetIndex`).
- Finalize idempotency and replay safety.
- Non-blocking finalize behavior for heavy media processing.
- Explicit readiness/status model (processing vs ready).

## B) Preserve Semantics, Clean Up Internally

- Consolidate route logic into v2 layered architecture (contracts/routes/orchestrators/services/repositories).
- Keep same lifecycle semantics while reducing branch sprawl.
- Improve diagnostics and policy clarity without changing external behavior.

## C) Improve Safely Now

- Add explicit v2 media control-plane routes linked to posting session:
  - media registration/binding
  - mark-uploaded signal
  - media status/readiness
- Tight idempotency and dedupe for repeated registration/mark-uploaded calls.
- Add strict polling cadence hints to reduce status storms.

## D) Defer (Not in This Phase)

- Full binary/media-plane replacement in v2.
- Full transcode/variant processing orchestration migration.
- Runtime-heavy upload-through-API routes as default path.
- Full legacy route deprecation/cutover.

## Native Compatibility Risks to Protect

- Breaking stage->finalize sequence assumptions.
- Breaking idempotency replay identity mapping.
- Breaking readiness semantics expected by reconcile polling.
- Introducing blocking operations into finalize/register paths.

## Recommended Smallest Safe v2 Slice

Implement only control-plane routes that align with legacy semantics:

1. `POST /v2/posting/media/register`
   - bind media asset metadata to existing posting session
   - return stable media id + expected storage key metadata
2. `POST /v2/posting/media/:mediaId/mark-uploaded`
   - signal direct upload completion idempotently
3. `GET /v2/posting/media/:mediaId/status`
   - provide readiness/status for reconcile polling

This preserves legacy structure (session + staged lifecycle + readiness) without migrating full data-plane.

## Behavioral Compatibility Notes

- v2 media routes remain non-binary control-plane.
- upload data still assumed direct-to-storage by client/legacy plane.
- posting finalize should continue to depend on stateful media/session readiness rather than raw upload response timing.

## Pressure-Safety Requirements for Slice

- no binary payload handling in this slice,
- idempotent registration and mark-uploaded,
- dedupe + concurrency caps for repeated calls,
- bounded status payload and recommended polling interval,
- scoped invalidation only where deterministic.
