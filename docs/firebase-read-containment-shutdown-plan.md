# Firebase read containment — shutdown plan

This document describes how **deny-by-default** Firebase access behaves across Locava Backendv2 (Fastify), Locava Backend (Express, including Wikimedia MVP), and Locava Web (Next.js). Implementation lives in `@locava/contracts/firebase-access-policy`, Backendv2 hooks and Firestore gates, Express middleware, and Web API / client guards.

## Modes

- **`LOCAVA_FIREBASE_ACCESS_MODE=normal`** (default): no new blocking behavior; optional warn-once logs for tagged legacy paths.
- **`LOCAVA_FIREBASE_ACCESS_MODE=locked_down`**: enforce containment. Backendv2 legacy compat routes, Web legacy v1 API calls, and Express non-Wikimedia traffic can be cut off per flags below.

Web uses the `NEXT_PUBLIC_*` mirror variables (see `Locava Web/.env.local.example` and `parseFirebaseAccessEnv` in contracts).

## Backendv2 (Fastify)

- **Early route shutdown**: `onRequest` evaluates `evaluateLegacyRouteShutdown` so legacy `/api/v1/product/*` paths that are granular-disabled return **503** with `LEGACY_FIREBASE_DISABLED` before heavy handlers run.
- **Firestore / Admin**: `getFirebaseAdminFirestore` and source client paths enforce policy via `enforceBackendV2FirebaseAccess` and request / background `firebaseGate` context.
- **Canonical `/v2/*`**: remains available when `ALLOW_BACKEND_V2_FIREBASE=true` (default true).
- **Legacy compat on v2**: allowed only if `ALLOW_BACKEND_V2_FIREBASE=true` and the relevant `DISABLE_LEGACY_*_FIRESTORE` flag for that surface is false.
- **Monolith outbound**: `assertMonolithProxyOutboundAllowed` restricts proxy URLs to the centralized allowlist when locked down and `ALLOW_BACKEND_V2_MONOLITH_PROXY=true`.
- **Debug**: `GET /debug/firebase-access-policy` when `ENABLE_DEV_DIAGNOSTICS` and `ENABLE_FIREBASE_ACCESS_DEBUG_ENDPOINT` are true (redacted snapshot only).

## Express (Locava Backend)

- With **`locked_down`** and **`DISABLE_LEGACY_FIREBASE`**, middleware returns **503** for all routes except Wikimedia (`/api/v1/wikimedia-mvp/*` pattern as implemented) and readiness/health as configured.
- Wikimedia controllers should still call `assertFirebaseAccessAllowed` at the boundary where MVP/staging flags apply.

## Locava Web

- **`apiClient` / `fetchWithAuthJSON`**: `assertWebApiAccessAllowed` runs before network I/O; blocked calls return a structured disabled payload without fetching.
- **Wikimedia admin**: use **`NEXT_PUBLIC_WIKIMEDIA_BACKEND_URL`** (or equivalent) so `/api/v1/wikimedia-mvp/*` hits Express while product traffic uses Backendv2.
- **Client Firestore / server `firebase-admin`**: guarded in `src/config/firebase.js` and `src/config/firebase-admin.js` when containment disables legacy web Firebase.

## Workers and listeners

- **`DISABLE_LEGACY_WORKERS`**, **`DISABLE_LEGACY_CRON`**, **`DISABLE_LEGACY_LISTENERS`**: gate Express scheduled work, Web polling/listeners, and selected internal routes as implemented in each codebase. Backendv2 **`scheduleBackgroundWork`** remains classified so v2 posting / notifications coalescing is not globally killed by legacy worker flags alone.

## Rollout checklist

1. Set **`LOCAVA_FIREBASE_ACCESS_MODE=locked_down`** in staging for Backendv2 and Express; set **`NEXT_PUBLIC_LOCAVA_FIREBASE_ACCESS_MODE=locked_down`** for Web builds as needed.
2. Enable granular **`DISABLE_LEGACY_*`** flags one surface at a time; watch 503 rates and client telemetry.
3. Confirm **`NEXT_PUBLIC_WIKIMEDIA_BACKEND_URL`** points at Express if Wikimedia UIs are in use.
4. Confirm monolith proxy allowlist covers required native paths before tightening **`ALLOW_BACKEND_V2_MONOLITH_PROXY`**.
5. Run **`npm run audit:firebase-containment`** in `Locava Backendv2` before release; resolve or baseline any new direct Firebase imports.

## Related

- [firebase-read-containment-audit-report.md](./firebase-read-containment-audit-report.md) — audit script and baseline policy.
