# Manual verification — auth sign-in (2026-05-03)

Use a **staging** Firebase project where possible before production.

## Deployed Backendv2 probes

```bash
curl -sS "https://<BACKENDV2_ORIGIN>/health/auth-capabilities" | jq .
```

Expect:

- `firebaseWebApiKeyConfigured`: true  
- `firebaseAdminConfigured`: true  
- `appleNoncePostBodySupported`: true  

`firebaseConsoleAppleProviderConfigured` / `firebaseConsoleGoogleProviderConfigured` are intentionally `null` (cannot be inferred server-side).

## Native — email/password

1. Existing user with password → sign in succeeds, session establishes.  
2. Existing **Google-only** email → tap Continue, enter password → message: use Google with same email (from backend normalization).  
3. Existing **Apple-only** email (known email on account) → same, Apple hint.

## Native — Google

1. Existing Google-complete profile → lands in app, token ok.  
2. New Google user → onboarding route, then profile create → custom token.  
3. If account is Apple-only **and** Google ID token exposes email → expect wrong-provider hint.  
4. Cancel Google sheet → **no** error Alert.

## Native — Apple (physical iOS device)

1. First sign-in → complete flow; nonce is sent (`rawNonce` + SHA256 hashed `nonce` to Apple per Apple docs).  
2. Second sign-in → Apple may omit email/name; backend must still resolve via Firebase uid / provider id (`federatedId` path).  
3. Missing identity token → local error before API call.

## Wrong-provider matrix (expected messaging)

| You try | Account has | Expected |
| --- | --- | --- |
| Email/password | Google | “used Google … continue with Google … same email” |
| Email/password | Apple | Apple hint |
| Google | Apple (same email visible in JWT) | Apple hint |
| Apple | Google (same email in token or body) | Google hint |
| Wrong password only | Password provider linked | Incorrect password |

## Firebase Console

- Email/password enabled.  
- Google provider enabled + correct Web client IDs in app.  
- Apple provider enabled + Service ID / key / bundle ID aligned with Firebase “Sign-in method” checklist.  

## Apple Developer Console

- Sign in with Apple capability on the Locava App ID matching the Xcode bundle identifier.  

## Google Cloud / OAuth clients

- iOS/Android OAuth clients match Expo `GOOGLE_PUBLIC_*` config.  

## Backend env (deploy)

- `FIREBASE_WEB_API_KEY` — web API key for **same** project as Firebase Admin.  
- Firebase Admin credentials (`FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` or GCP default credentials).  

## OAuth URIs inside Backendv2 Identity Toolkit requests

Hardcoded **`requestUri` / OAuth continue URI**: `https://locava.app/auth/callback`

That URL must remain authorized / consistent with Firebase “Authorized domains” expectations for OAuth. If Firebase requires `www.locava.app`, update **code** deliberately (currently single canonical URI).
