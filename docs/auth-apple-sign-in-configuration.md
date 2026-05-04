# Apple Sign-In: Firebase Console, Apple Developer, Locava Native, Backendv2

This document aligns **Sign in with Apple** across Firebase, Apple identifiers, Locava‑Native (Expo/iOS), and Backendv2.

## Two exchange modes (Backendv2)

`POST /v2/auth/signin/apple` supports **exactly one** of:

| Mode | Body | When to use |
|------|------|--------------|
| `apple_identity_toolkit_rest` | `identityToken` (+ optional `rawNonce`) | Legacy / tooling. Often **fails** when the Apple JWT `aud` is the **bundle ID** but Firebase Identity Toolkit was configured against the **Services ID**. |
| `firebase_apple_via_client_exchange` | `firebaseIdToken` | **Recommended for Locava‑Native.** The app completes Apple locally, exchanges with **Firebase Auth** via `OAuthProvider('apple.com')` + `signInWithCredential`, then sends `getIdToken()` to Backendv2. Backend verifies the Firebase session with **Admin SDK** and resolves the Locava user. |

Sending **both** `identityToken` and `firebaseIdToken` is rejected by the contract. Nonce verification is never skipped: on the toolkit path Backend forwards `nonce` to Toolkit when `rawNonce` is present and the Apple JWT carries a nonce; on the Firebase path Firebase Auth validates nonce when building the OAuth credential client-side.

## Firebase Console → Authentication → Apple

1. Enable **Apple** as a provider.
2. Configure **Apple** with your Apple Developer credentials (Team ID, key, key ID, bundle ID vs Services ID as required by Firebase’s wizard).
3. Ensure **Authorized domains** include every host used in `FIREBASE_AUTH_CONTINUE_URI` / OAuth flows (localhost, 127.0.0.1, prod domains).
4. The **exact** linkage between Firebase and Apple identifiers determines what `accounts:signInWithIdp` accepts. If Toolkit errors with **audience mismatch** (`apple_token_audience_mismatch`), use **`firebase_apple_via_client_exchange`** on iOS unless you deliberately reconfigure Firebase/Apple OAuth clients.

Locava‑Native expects the same Firebase **project** and **API key family** as Backendv2 (`EXPO_PUBLIC_*` and `FIREBASE_WEB_API_KEY`).

## Apple Developer

- **Bundle ID**: `com.judsondunne.locava` — used by the native app; Sign in with Apple identity tokens minted for native sign-in commonly have `aud=com.judsondunne.locava`.
- **Services ID**: `com.judsondunne.locava.web` — used for Apple “web” / OAuth configurations; JWTs minted there have `aud=com.judsondunne.locava.web`.
- Enable **Sign in with Apple** for the App ID, and associate the capability in Xcode / Expo entitlements.

## Locava‑Native (`Locava-Native`)

- Uses `expo-apple-authentication` for `identityToken`, **SHA‑256(hex)** hashed nonce passed to Apple, **`rawNonce`** kept for Firebase.
- Signs into **Firebase Auth** with `OAuthProvider('apple.com').credential({ idToken, rawNonce })` then **`signInWithCredential`**.
- Calls Backend with `oauthExchangeMode: 'firebase_apple_via_client_exchange'` and `firebaseIdToken` (Firebase **ID token**).

## Backendv2 environment variables

| Variable | Purpose |
|----------|---------|
| `FIREBASE_WEB_API_KEY` | Identity Toolkit REST for Google/password and **Apple toolkit** path (`signInWithIdp`). |
| `GOOGLE_APPLICATION_CREDENTIALS` or `FIREBASE_*` service account JSON | Firebase **Admin**: custom tokens, **`verifyIdToken`** for Firebase Apple path, Firestore.user resolution. |
| `FIREBASE_AUTH_CONTINUE_URI` | OAuth `requestUri`/continue host (authorized domains must match). |
| `APPLE_IOS_BUNDLE_ID` | Optional diagnostics label (defaults to `com.judsondunne.locava`). |
| `APPLE_WEB_SERVICES_ID` | Optional diagnostics label (defaults to `com.judsondunne.locava.web`). |
| `ENABLE_DEV_DIAGNOSTICS` | When true and `NODE_ENV !== production`, failed Apple responses may include **`authDiagnostics`** (`appleTokenAudience`, `recommendedFix`, etc.). |

Do **not** “accept both audiences” server-side based only on JWT `aud`; the client must declare the **`oauthExchangeMode`** so Backend uses the correct verifier.
