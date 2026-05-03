# Auth sign-in provider recovery — final report (2026-05-03)

## Root cause — Continue with Apple (deployed Backendv2 path)

Firebase REST **`accounts:signInWithIdp`** for **`apple.com`** requires the **raw nonce** in `postBody` (`nonce=<unhashed>`) when Sign in with Apple issued an identity token with a nonce claim. The backend omitted `nonce`, which matches common failures such as **`MISSING_OR_INVALID_NONCE`**.

Additionally, provider user id extraction relied on **`rawUserInfo`** fields; Firebase success payloads usually include **`federatedId`** (e.g. `https://appleid.apple.com/<sub>`), which is now preferred when parsing provider uid.

## Root cause — wrong-provider UX

Password and OAuth errors returned opaque Firebase toolkit strings. **`accounts:createAuthUri`** exposes `signInMethods` for known emails — used **only after failed attempts** so we can tell users to use Google/Apple/password without changing happy paths.

## Files changed

**Backend**

- `src/lib/auth-provider-resolution.ts` (+ tests) — JWT payload decode (unverified UX only), federated ID extraction helpers, normalization for password/oauth/register failures.  
- `src/routes/v2/auth-mutations.routes.ts` — Apple `nonce` in `postBody`, federated ID parsing via shared helper; Google prefers `idToken` when supplied; enriched login/register/google/apple failures; safe logs (`attemptedProvider`, `errorCode`, `normalizedProviderHint`, booleans).  
- `src/contracts/surfaces/auth-signin-google.contract.ts` — optional `idToken`; `accessToken` optional; one-of enforced.  
- `src/contracts/surfaces/auth-signin-apple.contract.ts` — optional `rawNonce`.  
- `src/contracts/surfaces/auth-login.contract.ts` / `auth-register.contract.ts` — optional `errorCode`.  
- `src/routes/system.routes.ts` — **`GET /health/auth-capabilities`** (non-secret).

**Native**

- `package.json` — `expo-crypto`; script `npm run test:auth-errors`.  
- `src/auth/AuthScreen.tsx` — SHA256 (**hex**) nonce for Apple (`digestStringAsync`), passes `rawNonce` to backend, Google/Apple/password UI errors via **`normalizeAuthUiErrorMessage`**.  
- `src/auth/auth.api.ts` — Google sends `idToken` when present; Apple sends `optional` `rawNonce`; result types gain `errorCode`.  
- `src/auth/auth.store.ts` — Google token object to API preferring ID token over access token only at wire level.  
- `src/auth/authErrorNormalization.ts` (+ `authErrorNormalization.test.ts`) — cancellations, network, pass-through backend messages.

## Tests added / updated

- Backend: `src/lib/auth-provider-resolution.test.ts` (vitest).  
- Existing `src/routes/v2/auth-mutations.routes.test.ts` still passes.  
- Native: `npm run test:auth-errors` (tsx asserts).

Run:

```bash
cd "Locava Backendv2" && npx vitest run src/lib/auth-provider-resolution.test.ts src/routes/v2/auth-mutations.routes.test.ts
cd "Locava-Native" && npm run test:auth-errors && node scripts/check-syntax.js
```

## How to verify locally

1. Backend: `npm run dev`, hit `POST /v2/auth/signin/apple` with stubbed Identity Toolkit responses in tests OR real Firebase project secrets in `.env`.  
2. Native: `expo run:ios`, exercise three providers per runbook (`docs/runbooks/auth-signin-verification-2026-05-03.md`).

## Required external configuration (still manual)

- Firebase Auth: Apple + Google providers enabled; Apple key + bundle ID wired.  
- Apple Developer: Sign in with Apple on the Locava bundle ID; Team / key / identifiers consistent with Firebase.  
- **Confirm** Apple's expected nonce hashing matches production (implemented: **SHA256 → lowercase hex string** passed to `AppleAuthentication.signInAsync({ nonce })`). If Apple rejects nonce format, revisit encoding (Firebase / Apple historically also use Base64(URL) variants in some snippets).  

## Risks / follow-ups

- `createAuthUri` may return empty `signInMethods` under Firebase email enumeration protections — fallback remains generic-safe.  
- `requestUri` is fixed to **`https://locava.app/auth/callback`** — if Firebase project differs, update consciously.  
- Backend `npm run typecheck` currently fails on unrelated `legacy-reels-near-me.routes.ts`; not addressed in this patch.
