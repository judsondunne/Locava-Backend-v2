# Auth sign-in provider recovery — audit (2026-05-03)

## Current auth flow map (Locava-Native + Backendv2)

| Method | Native | Backend | Firebase session on device |
| --- | --- | --- | --- |
| Email/password existing | `POST /v2/auth/login` → custom token → `signInWithCustomToken` | Identity Toolkit `accounts:signInWithPassword` | Yes (custom token) |
| Email/password new | Onboarding → `POST /v2/auth/register` (not AuthScreen primary CTA) | `accounts:signUp` | Yes after register |
| Google | `expo-auth-session` → `POST /v2/auth/signin/google` | Identity Toolkit `accounts:signInWithIdp` (`google.com`, id_token or access_token) | Yes when token returned |
| Apple | `expo-apple-authentication` → `POST /v2/auth/signin/apple` | Identity Toolkit `accounts:signInWithIdp` (`apple.com`, id_token) | Yes when token returned |

OAuth new users: backend returns `oauthInfo` + synthetic `userId` (`google_*` / `apple_*`); profile is created later via `POST /v2/auth/profile` and then custom token sign-in.

Legacy monolith proxy (`/api/auth/*`) exists only when `LEGACY_MONOLITH_PROXY_BASE_URL` is set; native uses `/v2/auth/*` directly.

## Current Apple sign-in path

- Native: `AuthScreen` → `AppleAuthentication.signInAsync` → `auth.store.signInWithApple` → `auth.api.signInWithApple` → `POST /v2/auth/signin/apple`.
- Backend: validates body, calls Firebase REST `signInWithIdp`, then `AuthMutationsService.resolveOauthAccount` (uid / legacy `apple_{sub}` / email / Auth user).

Apple is **backend-assisted** (Firebase REST on the server), not a pure on-device Firebase OAuth client.

## Provider mismatch behavior (before fixes)

- Backend login/register returned raw Firebase REST error strings (e.g. `INVALID_LOGIN_CREDENTIALS`) with no interpretation.
- Native `AuthScreen` used a small regex mapper that did **not** use `accounts:createAuthUri` sign-in methods or distinguish “wrong password” vs “social-only account”.
- OAuth failures surfaced generic Firebase-style errors.

## Root cause hypotheses (validated in code review)

1. **Apple (+ deployed backend)**  
   Firebase REST `accounts:signInWithIdp` for Apple commonly requires `nonce=<raw_nonce>` in `postBody` when the Apple identity token carries a nonce (Sign in with Apple + Firebase expectation). Backend previously omitted `nonce` → plausible production errors such as **`MISSING_OR_INVALID_NONCE`**. Also, provider UID extraction relied on `rawUserInfo.sub`; Firebase responses typically include top-level **`federatedId`** (more reliable).

2. **Provider mismatch UX**  
   No use of **`createAuthUri`** (`signInMethods`) after password or OAuth failures, so users saw opaque messages instead of “use Google / Apple” hints.

## Files targeted for changes

**Backend:** `auth-mutations.routes.ts`, contracts (`auth-login`, `auth-register`, `auth-signin-google`, `auth-signin-apple`), `lib/auth-provider-resolution.ts`, `routes/system.routes.ts` (health probe), tests.

**Native:** `AuthScreen.tsx` (nonce + UI errors), `auth.api.ts`, `auth.store.ts`, `authErrorNormalization.ts`, tests, `expo-crypto` dependency.

## Safety constraints honored

- No logging of passwords, tokens, or raw JWTs in new diagnostics (only lengths / booleans).
- Provider hints computed only **after** a failed login/register/OAuth attempt with an email/token already supplied by the client (or JWT email claim decode for UX only — not verified crypto).
- Do not weaken Firestore-backed auth readiness gates.
