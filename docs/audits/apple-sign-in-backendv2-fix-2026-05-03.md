# Apple Sign-In (Backendv2) — Audit & Fix (2026-05-03)

## TL;DR

| Area | Finding |
| --- | --- |
| **Misleading OAuth banner** | `LEGACY_MONOLITH_PROXY_BASE_URL` activated a line implying “OAuth/email auth is proxied.” **`POST /v2/auth/signin/apple`** and **`/v2/auth/signin/google`** are handled **only** by Backendv2 via **Firebase Identity Toolkit REST** (`accounts:signInWithIdp`). Legacy proxy applies to **`/api/auth/*`** when `ENABLE_LEGACY_COMPAT_ROUTES` is enabled. |
| **`apple_idp_failed`** | This was an **opaque bucket** whenever Firebase returned messages containing `INVALID_IDP` / similar, or fell through **`normalizeOAuthSignInFailure`**. It did **not** prove the proxy was mis-targeted—it proved the toolkit exchange rejected the credential (token, Firebase Apple provider linkage, nonce, domain allowlist, or API key mismatch). |
| **Analytics publisher SA (`analytics-publisher@`)** | A **GCP service account wired only for Analytics/BigQuery** cannot mint custom tokens nor read Auth/User records. **`GOOGLE_APPLICATION_CREDENTIALS`** for local Backendv2 must resolve to **Firebase-compatible admin material** (`firebase-adminsdk-*` JSON, Firebase env cert triple, or App Engine–style Firebase Admin IAM on Cloud Run). |
| **`FIREBASE_AUTH_CONTINUE_URI` / Authorized domains** | Toolkit calls require a **continue/request URI** whose hostname is authorized in Firebase Authentication. Backendv2 defaults to **`https://locava.app/auth/callback`**; local dev should set **`FIREBASE_AUTH_CONTINUE_URI=http://127.0.0.1:8080/auth/callback`** (or LAN host) **after** adding **`localhost`**, **`127.0.0.1`**, **`locava-backend-v2-*`**.run.app, etc., under **Authentication → Authorized domains**. |

---

## Root cause (current failure mode)

Combining logs (`auth_apple_failure_normalized`, `apple_idp_failed`, `hasEmail`, `nonceProvided`) with code inspection:

1. **Native reaches Backendv2** with `identityToken`, `email`, and `rawNonce`.
2. Backend calls **`accounts:signInWithIdp`** with **Apple** `providerId`, `id_token`, optional **`nonce`** (when provided).
3. Firebase returns **`FAILED_PRECONDITION`-style toolkit errors often surfaced as INVALID_IDP* /INVALID_ID_TOKEN**/ similar** mapping to **`apple_idp_failed`** pre-change.
4. Likely upstream causes remain **Firebase Console configuration** relative to **this** codebase (Apple Service ID/Team ID/private key parity, **Authorized domains** vs configured **requestUri**, **`FIREBASE_WEB_API_KEY` project alignment**, **API key restriction** disallowing Identity Toolkit REST from server egress, or stale Apple identity token)—**not** the legacy monolith banner value.

Separate path: **`firebase_admin_permission_failed`** when **Firestore/Admin** operations after a successful toolkit exchange fail—the analytics-only SA manifests here.

---

## Files changed

- `Locava Backendv2/src/routes/v2/auth-mutations.routes.ts` — Identity Toolkit plumbing, granular Apple errors, JWT nonce precheck (**`missing_nonce`**), **`classifyFirebaseAuthSupportingFailure`** for Google+Apple supporting services, **`FIREBASE_AUTH_CONTINUE_URI`** usage.
- `Locava Backendv2/src/lib/firebase-identity-toolkit.ts` — Toolkit error taxonomy, **`IdentityToolkitExchangeError`**, **`classifyFirebaseAuthSupportingFailure`**, proxy loop comparator, **`FIREBASE_CONSOLE_AUTHORIZED_DOMAIN_CHECKLIST`** hints.
- `Locava Backendv2/src/lib/auth-provider-resolution.ts` — `FETCH_FAILED` / `INVALID_JSON_RESPONSE` → **`firebase_credential_exchange_failed`** for OAuth UX.
- `Locava Backendv2/src/lib/firebase-admin.ts` — Logs **`firebase_admin_credential_requires_fix`** when **`analytics-publisher`**-like ADC is detected.
- `Locava Backendv2/src/config/env.ts` — **`FIREBASE_AUTH_CONTINUE_URI`**, **`BACKEND_PUBLIC_BASE_URL`**.
- `Locava Backendv2/src/boot/printDevListenUrls.ts`, `Locava Backendv2/src/server.ts` — Accurate OAuth vs legacy proxy banner.
- `Locava Backendv2/src/routes/system.routes.ts` — `/health/auth-capabilities` echoes resolved continue URI.
- `Locava Backendv2/src/routes/compat/legacy-monolith-auth-proxy.routes.ts` — **`legacy_proxy_failed`** on upstream fetch rejection.
- `Locava Backendv2/src/contracts/surfaces/auth-signin-apple.contract.ts` — Optional **`authDiagnostics`** (non-prod + `ENABLE_DEV_DIAGNOSTICS`).
- `Locava Backendv2/src/app/createApp.ts`, `Locava Backendv2/src/observability/config-health.service.ts` — Backend/Legacy collision warnings.
- `Locava Backendv2/.env.example` — Documented Firebase/continue/proxy knobs.
- `Locava Backendv2/test/vitest.setup.ts`, `Locava Backendv2/vitest.config.ts`, test updates — deterministic harness bootstrap + new cases.

---

## Error codes (Apple path)

| `errorCode` | When |
| --- | --- |
| `missing_nonce` | JWT payload includes Apple's **`nonce` hash**, but **`rawNonce` body** is absent/too short (**before** toolkit call). |
| `apple_nonce_verify_failed` | Firebase toolkit reports **`MISSING_OR_INVALID_NONCE`**. |
| `apple_token_verify_failed` | Token/provider mismatch surfaced as **`INVALID_IDP*`**, **`INVALID_ID_*`**, etc. |
| `firebase_credential_exchange_failed` | Network/`FETCH_FAILED`, malformed toolkit JSON, API key/App-not-authorized, **`INVALID_CREDENTIAL`**, **`OPERATION_NOT_ALLOWED`**, incomplete toolkit payload (**`provider_id_missing`** shim). |
| `firebase_admin_permission_failed` | Post-exchange Firestore/Auth Admin denies access (analytics SA pattern). |
| `legacy_proxy_failed` | **Only** **`/api/auth/*`** compat proxy upward `fetch` throws. |

Google keeps prior normalization with added **`firebase_credential_exchange_failed`** for fetch/toolkit outages and **`firebase_admin_permission_failed`** when supporting services deny.

---

## Environment variables

| Variable | Role |
| --- | --- |
| **`FIREBASE_WEB_API_KEY`** | REQUIRED for **`accounts:signInWithIdp` / createAuthUri** REST (same Firebase project as the native app bundle). Prefer an **unrestricted** or **properly keyed** GCP API key Identity Toolkit allows from server egress. |
| **`FIREBASE_AUTH_CONTINUE_URI`** | Optional toolkit redirect host (must be **authorized domains**–listed). Defaults to **`https://locava.app/auth/callback`**. |
| **`LEGACY_MONOLITH_PROXY_BASE_URL`** | Classic monolith (**NOT** Backendv2) for uploads + optional **`/api/*`** proxies. |
| **`BACKEND_PUBLIC_BASE_URL`** | Your deployed/current Backendv2 public origin (**Cloud Run**) or LAN URL—used **only** to warn on proxy loops versus legacy base. |
| **`GOOGLE_APPLICATION_CREDENTIALS` / FIREBASE_* env certs** | **Firebase-admin-capable**, not **`analytics-publisher@`**. |

---

## Local development (8080)

1. **Backendv2** on port **8080** (`HOST=::` default).
2. Set **`EXPO_PUBLIC_BACKEND_V2_URL=http://127.0.0.1:8080`** for Simulator; **`http://<LAN-IP>:8080`** on device.
3. Configure **`.env`**: **`FIREBASE_WEB_API_KEY`**, **`GCP_PROJECT_ID` / `FIREBASE_PROJECT_ID`**, **`GOOGLE_APPLICATION_CREDENTIALS`** (firebase adminsdk JSON), optional **`FIREBASE_AUTH_CONTINUE_URI=http://127.0.0.1:8080/auth/callback`**, **`BACKEND_PUBLIC_BASE_URL=http://127.0.0.1:8080`**.
4. Firebase Console → Authorized domains → add **`localhost`**, **`127.0.0.1`**, and any **`http://LAN_IP:8080`** host-only domain as required.
5. Verify **`GET http://127.0.0.1:8080/health/auth-capabilities`** for API key presence + echoed continue URI.

---

## Deployed Backendv2 (Cloud Run example)

Production URL **`https://locava-backend-v2-nboawyiasq-uc.a.run.app`** must be authorized in Firebase Authentication if you intend to use Cloud Run-origin continue URIs. Set **`BACKEND_PUBLIC_BASE_URL`** accordingly. **`LEGACY_MONOLITH_PROXY_BASE_URL`** stays pointed at **`https://locava-backend-nboawyiasq-uc.a.run.app`** (classic monolith **only**)—never the Backendv2 origin unless deliberate (and guarded by WARN logs).

IAM: attach **Firebase Authentication Admin**/**Service Account Token Creator**/Firestore roles consistent with **`firebase-admin` SDK** usage—not analytics-only principals.

---

## Manual testing

### iOS Simulator

1. Run Backendv2 with correct `.env` (see Local development).
2. Launch Locava Native with **`EXPO_PUBLIC_BACKEND_V2_URL=http://127.0.0.1:8080`**.
3. Sign in with Apple; tail logs for **`auth_apple_failure_normalized`** (**`errorCode`**, **`firebaseToolkitRawMessage`** in non-prod diagnostics).
4. Success path completes toolkit exchange + optional custom token issuance.

### Physical iPhone (LAN Expo)

Same as Simulator but **`EXPO_PUBLIC_BACKEND_V2_URL=http://PHONE-REACHABLE-LAN-IP:8080`**—update Firebase authorized domains accordingly.

---

## Constraint checklist

| Constraint | Status |
| --- | --- |
| Do not bypass nonce verification | ✅ Nonce JWT precheck + toolkit path unchanged logically (still sends hashed verification to Firebase when provided). |
| Do not silently route Apple through legacy | ✅ `/v2/*` untouched by legacy auth proxy unless client explicitly hits `/api/auth/*`. |
| Do not introduce Backendv2↔Backendv2 proxy loops unknowingly | ✅ Startup + config-health warnings when legacy origin matches **`BACKEND_PUBLIC_BASE_URL`**. |
| Preserve Google/email | ✅ Google/email paths retained; toolkit fetch errors surfaced conservatively without hiding failures. |

---

## Verification commands

```bash
cd "Locava Backendv2"
npx vitest run src/lib/firebase-identity-toolkit.test.ts \
  src/routes/v2/auth-mutations.routes.test.ts \
  src/routes/compat/legacy-monolith-auth-proxy.routes.test.ts
npm run typecheck
```
