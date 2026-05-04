import type { AppEnv } from "../config/env.js";
import {
  extractToolkitAppleAudienceMismatch,
  audienceMismatchRecommendedFix
} from "./apple-exchange-diagnostics.js";
import {
  normalizeFirebaseToolkitCode,
  normalizeOAuthSignInFailure
} from "./auth-provider-resolution.js";
import { FirebaseAppleIdTokenExchangeError } from "./apple-firebase-backend-exchange.js";
import { AppleNativeJwtVerifyError } from "./apple-native-jwt-verify.js";

export const DEFAULT_FIREBASE_TOOLKIT_CONTINUE_URI = "https://locava.app/auth/callback";

/**
 * Authorized domains Firebase expects for OAuth / Identity Toolkit redirects.
 * Backend operators must mirror these under Firebase Console → Authentication → Settings → Authorized domains.
 */
export const FIREBASE_CONSOLE_AUTHORIZED_DOMAIN_CHECKLIST = [
  "localhost",
  "127.0.0.1",
  "locava.app",
  "locava-backend-nboawyiasq-uc.a.run.app",
  "locava-backend-v2-nboawyiasq-uc.a.run.app"
] as const;

export function resolveFirebaseToolkitContinueUri(env: AppEnv): string {
  const raw = typeof env.FIREBASE_AUTH_CONTINUE_URI === "string" ? env.FIREBASE_AUTH_CONTINUE_URI.trim() : "";
  return raw.length > 0 ? raw : DEFAULT_FIREBASE_TOOLKIT_CONTINUE_URI;
}

export class IdentityToolkitExchangeError extends Error {
  readonly name = "IdentityToolkitExchangeError";
  readonly firebaseMessage: string;
  readonly httpStatus: number | null;

  constructor(firebaseMessage: string, httpStatus?: number | null, cause?: unknown) {
    super(`firebase_identity_toolkit:${firebaseMessage}`, { cause });
    this.firebaseMessage = firebaseMessage;
    this.httpStatus = typeof httpStatus === "number" ? httpStatus : null;
  }
}

export type AppleSignInClassifiedFailure = {
  errorCode: string;
  userMessage: string;
  phase: "toolkit_precheck" | "toolkit_exchange" | "oauth_resolution" | "firebase_client_exchange";
  toolkitMeta?: {
    kind: "audience_mismatch";
    appleTokenAudience: string;
    firebaseExpectedAudienceToolkit: string;
    bundleIdConfigured: string;
    webServicesIdConfigured: string;
    recommendedFix: string;
  };
};

export type AppleToolkitClassifyContext = {
  appleIosBundleId?: string | null;
  appleWebServicesId?: string | null;
};

/** Map Identity Toolkit messaging for apple.com exchanges to precise client/log codes */
export function classifyAppleIdentityToolkitMessage(
  firebaseMessage: string,
  ctx?: AppleToolkitClassifyContext
): AppleSignInClassifiedFailure | null {
  const normalizedBundle = typeof ctx?.appleIosBundleId === "string" && ctx.appleIosBundleId.trim().length > 0
    ? ctx.appleIosBundleId.trim()
    : "com.judsondunne.locava";
  const normalizedWeb = typeof ctx?.appleWebServicesId === "string" && ctx.appleWebServicesId.trim().length > 0
    ? ctx.appleWebServicesId.trim()
    : "com.judsondunne.locava.web";

  const audienceMismatch = extractToolkitAppleAudienceMismatch(firebaseMessage);
  if (audienceMismatch) {
    const fix = audienceMismatchRecommendedFix({
      tokenAudience: audienceMismatch.tokenAudience,
      expectedAudience: audienceMismatch.expectedAudience,
      bundleIdConfigured: normalizedBundle,
      webServicesIdConfigured: normalizedWeb
    });
    return {
      errorCode: "apple_token_audience_mismatch",
      userMessage: `Apple sign-in failed because the Apple token audience (${audienceMismatch.tokenAudience}) does not match what Firebase Identity Toolkit expects (${audienceMismatch.expectedAudience}). Prefer the current Locava iOS flow (Firebase Auth on-device, then oauthExchangeMode=firebase_apple_via_client_exchange) or align Firebase Apple provider identifiers. Detailed steps are included in authentication diagnostics.`,
      phase: "toolkit_exchange",
      toolkitMeta: {
        kind: "audience_mismatch" as const,
        appleTokenAudience: audienceMismatch.tokenAudience,
        firebaseExpectedAudienceToolkit: audienceMismatch.expectedAudience,
        bundleIdConfigured: normalizedBundle,
        webServicesIdConfigured: normalizedWeb,
        recommendedFix: fix
      }
    };
  }

  const code = normalizeFirebaseToolkitCode(firebaseMessage);

  if (code.includes("FETCH_FAILED") || code.includes("INVALID_JSON_RESPONSE")) {
    return {
      errorCode: "firebase_credential_exchange_failed",
      userMessage:
        "Could not reach Firebase Authentication or parse its response. Check server network, firewall, and FIREBASE_WEB_API_KEY.",
      phase: "toolkit_exchange"
    };
  }

  if (code.includes("MISSING_OR_INVALID_NONCE")) {
    return {
      errorCode: "apple_nonce_verify_failed",
      userMessage:
        "Apple sign-in nonce did not verify with Firebase. Update the app, sign out fully, then try Apple again—or use Google or email.",
      phase: "toolkit_exchange"
    };
  }

  if (
    code.includes("INVALID_ID_TOKEN") ||
    code.includes("INVALID_ID_RESPONSE") ||
    code.includes("MALFORMED_TOKEN") ||
    code.includes("MALFORMED_ID_TOKEN")
  ) {
    return {
      errorCode: "apple_token_verify_failed",
      userMessage: "Apple issued a token Firebase could not accept. Retry sign-in once; if this persists, check Apple Developer + Firebase Apple provider configuration.",
      phase: "toolkit_exchange"
    };
  }

  if (code.includes("INVALID_IDP") || code.includes("UNAUTHORIZED_DOMAIN") || code.includes("ADMIN_ONLY_OPERATION")) {
    return {
      errorCode: "apple_token_verify_failed",
      userMessage:
        "Apple sign-in was rejected during Firebase verification. Confirm this Firebase project's Apple provider (Service ID, Team ID, key) matches the shipped app bundle.",
      phase: "toolkit_exchange"
    };
  }

  if (code.includes("INVALID_KEY") || code.includes("APP_NOT_AUTHORIZED_TO_USE_FIREBASE")) {
    return {
      errorCode: "firebase_credential_exchange_failed",
      userMessage:
        "This server cannot reach Firebase Authentication with its configured web API key. Verify FIREBASE_WEB_API_KEY matches the same Firebase project as the mobile app.",
      phase: "toolkit_exchange"
    };
  }

  if (code.includes("OPERATION_NOT_ALLOWED")) {
    return {
      errorCode: "firebase_credential_exchange_failed",
      userMessage: "Apple sign-in is disabled for this Firebase project. Enable the Apple provider (and OAuth redirect configuration) in Firebase Console.",
      phase: "toolkit_exchange"
    };
  }

  if (code.includes("USER_DISABLED") || code.includes("DISABLED_USER")) {
    return {
      errorCode: "user_disabled",
      userMessage: "This account has been disabled. Contact support if you need help.",
      phase: "toolkit_exchange"
    };
  }

  if (code.includes("INVALID_CREDENTIAL")) {
    return {
      errorCode: "firebase_credential_exchange_failed",
      userMessage:
        "Firebase declined the credential minted after Apple verification. Retry once; if persistent, inspect Identity Toolkit quotas, API key restrictions, and Apple provider linkage.",
      phase: "toolkit_exchange"
    };
  }

  return null;
}

export function resolveAppleToolkitFailureMessaging(
  firebaseMessage: string,
  ctx?: AppleToolkitClassifyContext
): { errorCode: string; userMessage: string; toolkitMeta?: AppleSignInClassifiedFailure["toolkitMeta"] } {
  const trimmed = firebaseMessage.trim();
  if (
    trimmed.length === 0 ||
    trimmed.toUpperCase() === "UNKNOWN_TOOLKIT_FAILURE" ||
    trimmed.toUpperCase() === "IDP_SIGN_IN_FAILED"
  ) {
    return {
      errorCode: "firebase_credential_exchange_failed",
      userMessage:
        "Firebase returned an unidentified authentication error during Apple credential exchange. Enable dev diagnostics (`authDiagnostics`) + server logs (`firebaseToolkitRawMessage`) or inspect GCP Identity Toolkit API responses."
    };
  }

  const classified = classifyAppleIdentityToolkitMessage(trimmed, ctx);
  if (classified) {
    return {
      errorCode: classified.errorCode,
      userMessage: classified.userMessage,
      toolkitMeta: classified.toolkitMeta
    };
  }
  const norm = normalizeOAuthSignInFailure({
    attemptedProvider: "apple",
    firebaseErrorMessage: firebaseMessage,
    signInMethods: []
  });
  return { errorCode: norm.errorCode, userMessage: norm.userMessage };
}

export function isFirestoreOrAuthPermissionDenied(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const any = err as { code?: string | number; message?: string; status?: string | number };
  const status = typeof any.status === "string" ? any.status.toUpperCase() : any.status;
  const codeNorm = typeof any.code === "string" ? any.code.trim().toUpperCase() : any.code;
  if (
    status === "PERMISSION_DENIED" ||
    status === 7 ||
    codeNorm === "PERMISSION_DENIED" ||
    codeNorm === 7 ||
    codeNorm === "7"
  ) {
    return true;
  }
  const msg = String(any.message ?? "").toLowerCase();
  return msg.includes("permission_denied") || msg.includes("insufficient permission") || msg.includes("caller does not have permission");
}

/**
 * Covers failures after toolkit exchange (Firestore/Auth Admin lookups, token minting, etc.).
 * Used by both Apple + Google OAuth routes — not toolkit-specific despite the legacy name mention.
 */
export function classifyFirebaseAuthSupportingFailure(err: unknown): { errorCode: string; userMessage: string } | null {
  if (err instanceof AppleNativeJwtVerifyError) {
    const map: Record<string, { errorCode: string; userMessage: string }> = {
      apple_jwt_nonce_mismatch: {
        errorCode: "apple_nonce_verify_failed",
        userMessage:
          "Apple sign-in nonce verification failed on the server. Force-quit Locava and try Apple again—or use Google or email."
      },
      apple_jwt_audience_invalid: {
        errorCode: "apple_native_jwt_audience_mismatch",
        userMessage:
          "Apple verified on the wrong app identifier audience. Backend expects your iOS bundle ID (native token). Confirm APPLE_IOS_BUNDLE_ID matches com.judsondunne.locava on Backendv2."
      },
      apple_jwt_invalid: {
        errorCode: "apple_token_verify_failed",
        userMessage:
          "Apple identity token failed verification on the server. Update the Locava build, revoke Apple tokens in Settings ▸ Apple ▸ Password & Security ▸ Apps Using Sign in with Apple, then retry."
      },
      apple_jwt_expired_or_invalid_signature: {
        errorCode: "apple_token_verify_failed",
        userMessage:
          "Apple rejected the credential (expired or invalid signature). Sign out of Apple everywhere for Locava once, reinstall if needed, and retry—or use Google or email."
      }
    };
    return map[err.code] ?? {
      errorCode: "apple_token_verify_failed",
      userMessage: err.message.length > 260 ? `${err.message.slice(0, 260)}…` : err.message
    };
  }

  if (err instanceof FirebaseAppleIdTokenExchangeError) {
    const map: Record<string, { errorCode: string; userMessage: string }> = {
      firebase_id_token_verify_failed: {
        errorCode: "apple_firebase_id_token_invalid",
        userMessage: "Your signed-in session could not be verified. Sign out and try Apple again, or update the app."
      },
      firebase_id_token_provider_not_apple: {
        errorCode: "apple_firebase_session_not_apple",
        userMessage: "The Firebase session sent to the server is not an Apple sign-in. Use Apple on this device or sign out of Firebase Auth and retry."
      },
      firebase_user_lookup_failed: {
        errorCode: "apple_firebase_user_lookup_failed",
        userMessage: "Apple sign-in connected to Firebase but the user record is missing. Try again or contact support."
      },
      firebase_user_missing_apple_provider: {
        errorCode: "apple_firebase_missing_apple_link",
        userMessage: "Firebase user is not linked to Apple. Sign out fully and sign in with Apple again."
      },
      firebase_id_token_missing_uid: {
        errorCode: "apple_firebase_id_token_invalid",
        userMessage: "Invalid Firebase session token. Update the app and try Apple sign-in again."
      }
    };
    return map[err.code] ?? {
      errorCode: "apple_firebase_exchange_failed",
      userMessage: err.message.length > 240 ? `${err.message.slice(0, 240)}…` : err.message
    };
  }

  const raw = err instanceof Error ? err.message : String(err ?? "");

  if (raw === "firebase_web_api_key_missing" || raw.includes("firebase_web_api_key_missing")) {
    return {
      errorCode: "firebase_credential_exchange_failed",
      userMessage: "Server is missing FIREBASE_WEB_API_KEY (Firebase Web Config API key); native Apple/Google cannot authenticate until it is configured."
    };
  }

  if (raw === "provider_id_missing" || raw === "firebase_uid_missing") {
    return {
      errorCode: "firebase_credential_exchange_failed",
      userMessage: "Firebase returned an incomplete Apple authorization payload. Inspect Identity Toolkit logs and mobile client configuration."
    };
  }

  if (isFirestoreOrAuthPermissionDenied(err)) {
    return {
      errorCode: "firebase_admin_permission_failed",
      userMessage:
        "The server credential cannot read/write Firebase Auth or Firestore needed for login. Assign Firebase Admin-compatible roles or use an app-engine default / dedicated Firebase service account for local GOOGLE_APPLICATION_CREDENTIALS."
    };
  }

  if (raw === "firebase_auth_unavailable") {
    return {
      errorCode: "firebase_admin_permission_failed",
      userMessage: "Firebase Admin is not initialized; custom session tokens cannot be minted."
    };
  }

  return null;
}

export function normalizedOriginsComparable(aRaw: string, bRaw: string): boolean {
  try {
    const a = new URL(aRaw.endsWith("/") ? aRaw.slice(0, -1) : aRaw);
    const b = new URL(bRaw.endsWith("/") ? bRaw.slice(0, -1) : bRaw);
    return a.origin === b.origin;
  } catch {
    const norm = (s: string) =>
      s
        .trim()
        .replace(/\/+$/, "")
        .toLowerCase();
    return norm(aRaw) === norm(bRaw);
  }
}

export function legacyProxyLoopsToBackendTargets(input: {
  legacyBaseUrl: string | undefined | null;
  backendPublicUrls: Array<string | undefined | null>;
}): string | false {
  const legacy = typeof input.legacyBaseUrl === "string" ? input.legacyBaseUrl.trim() : "";
  if (!legacy) return false;
  let legacyOrigin: string;
  try {
    legacyOrigin = new URL(legacy).origin;
  } catch {
    return false;
  }
  for (const candidate of input.backendPublicUrls) {
    if (typeof candidate !== "string") continue;
    const t = candidate.trim();
    if (!t) continue;
    try {
      if (new URL(t).origin === legacyOrigin) return t;
    } catch {
      /* ignore */
    }
  }
  return false;
}
