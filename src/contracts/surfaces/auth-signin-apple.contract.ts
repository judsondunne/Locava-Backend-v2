import { z } from "zod";
import { defineContract } from "../conventions.js";

/** Public list for probes (e.g. `/health/auth-capabilities`) — keep in sync with `appleOauthExchangeModeSchema`. */
export const APPLE_OAUTH_EXCHANGE_MODES = [
  "apple_identity_toolkit_rest",
  "firebase_apple_via_client_exchange",
  /** Verifies Apple's JWT locally (JWKS); native bundle-ID `aud`; bypasses Firebase Identity Toolkit audience pinning. */
  "apple_native_jwk_verified"
] as const;

export type AppleOauthExchangeMode = (typeof APPLE_OAUTH_EXCHANGE_MODES)[number];

export const appleOauthExchangeModeSchema = z.enum(APPLE_OAUTH_EXCHANGE_MODES);

export const AuthSigninAppleBodySchema = z
  .object({
    /** Default: Firebase Identity Toolkit REST (legacy tooling). Native Locava prefers `apple_native_jwk_verified`. */
    oauthExchangeMode: appleOauthExchangeModeSchema.default("apple_identity_toolkit_rest"),
    /** Apple's identity JWT from `expo-apple-authentication`; required for `apple_identity_toolkit_rest` and `apple_native_jwk_verified`. Must NOT be sent with firebase_apple_via_client_exchange. */
    identityToken: z.string().optional(),
    /**
     * Firebase Auth session ID token after native `OAuthProvider('apple.com').credential({ idToken: appleJwt, rawNonce })` +
     * `signInWithCredential`. Required only for `firebase_apple_via_client_exchange`.
     */
    firebaseIdToken: z.string().optional(),
    /**
     * Raw (unhashed) Sign in with Apple nonce. Must match what was SHA256-hashed and passed to `AppleAuthentication.signInAsync({ nonce })`.
     * Required for Firebase Identity Toolkit REST when Apple JWT includes nonce; also required client-side when building Firebase OAuth credential for Apple.
     */
    rawNonce: z.string().trim().min(8).max(256).optional(),
    authorizationCode: z.string().optional(),
    email: z.string().trim().email().optional(),
    fullName: z.union([
      z.string(),
      z.object({ givenName: z.string().optional(), familyName: z.string().optional() })
    ]).optional(),
    authIntent: z.enum(["sign_in", "sign_up"]).optional(),
    branchData: z.record(z.unknown()).nullable().optional()
  })
  .superRefine((data, ctx) => {
    const mode = data.oauthExchangeMode ?? "apple_identity_toolkit_rest";
    const idTok = !!(data.identityToken && data.identityToken.trim().length > 0);
    const fbTok = !!(data.firebaseIdToken && data.firebaseIdToken.trim().length > 0);

    if (mode === "firebase_apple_via_client_exchange") {
      if (!fbTok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "firebaseIdToken_required_when_oauth_exchange_mode_is_firebase_apple_via_client_exchange",
          path: ["firebaseIdToken"]
        });
      }
      if (idTok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "identityToken_must_not_be_sent_when_oauth_exchange_mode_is_firebase_apple_via_client_exchange",
          path: ["identityToken"]
        });
      }
    } else if (mode === "apple_identity_toolkit_rest") {
      if (!idTok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "identityToken_required_when_oauth_exchange_mode_is_apple_identity_toolkit_rest",
          path: ["identityToken"]
        });
      }
      if (fbTok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "firebaseIdToken_must_not_be_sent_when_oauth_exchange_mode_is_apple_identity_toolkit_rest",
          path: ["firebaseIdToken"]
        });
      }
    } else if (mode === "apple_native_jwk_verified") {
      if (!idTok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "identityToken_required_when_oauth_exchange_mode_is_apple_native_jwk_verified",
          path: ["identityToken"]
        });
      }
      if (fbTok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "firebaseIdToken_must_not_be_sent_when_oauth_exchange_mode_is_apple_native_jwk_verified",
          path: ["firebaseIdToken"]
        });
      }
    }
  });

const AuthAppleOauthInfoSchema = z.object({
  provider: z.literal("apple"),
  providerId: z.string().min(1),
  email: z.string().trim().email().optional(),
  displayName: z.string().optional()
});

const AccountStatusSchema = z.enum([
  "existing_complete",
  "existing_incomplete",
  "new_account_required"
]);

const AuthViewerSchema = z.object({
  uid: z.string(),
  canonicalUserId: z.string(),
  email: z.string().nullable(),
  handle: z.string().nullable(),
  name: z.string().nullable(),
  profilePic: z.string().nullable(),
  profilePicSmallPath: z.string().nullable(),
  profilePicMediumPath: z.string().nullable(),
  profilePicLargePath: z.string().nullable(),
  onboardingComplete: z.boolean().nullable(),
  profileComplete: z.boolean().nullable(),
  viewerReady: z.boolean(),
  profileHydrationStatus: z.enum(["ready", "minimal_fallback"])
});

export const AuthSigninAppleResponseSchema = z.object({
  routeName: z.literal("auth.signin_apple.post"),
  success: z.boolean(),
  isNewUser: z.boolean().optional(),
  accountStatus: AccountStatusSchema.optional(),
  onboardingRequired: z.boolean().optional(),
  nativeDestinationRoute: z.enum(["app", "onboarding_existing", "onboarding_new"]).optional(),
  user: z
    .object({
      uid: z.string(),
      email: z.string().optional(),
      displayName: z.string().optional()
    })
    .optional(),
  viewer: AuthViewerSchema.optional(),
  token: z.string().optional(),
  oauthInfo: AuthAppleOauthInfoSchema.optional(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
  /** Included only when ENABLE_DEV_DIAGNOSTICS is enabled and NODE_ENV !== production */
  authDiagnostics: z
    .object({
      failurePhase: z
        .enum([
          "toolkit_precheck",
          "toolkit_exchange",
          "oauth_resolution",
          "firebase_client_exchange",
          "apple_jwk_verify",
          "unknown"
        ])
        .optional(),
      oauthExchangeMode: appleOauthExchangeModeSchema.optional(),
      firebaseToolkitRawMessage: z.string().nullable().optional(),
      identityToolkitHttpStatus: z.number().optional(),
      caughtMessage: z.string().optional(),
      identityTokenJwtHasNonceClaim: z.boolean().optional(),
      appleTokenAudience: z.string().optional(),
      firebaseExpectedAudienceToolkit: z.string().optional(),
      bundleIdEcho: z.string().optional(),
      serviceIdEcho: z.string().optional(),
      recommendedFix: z.string().optional()
    })
    .optional()
});

// invalidation: Apple sign-in changes auth session state and may branch into profile bootstrap/onboarding.
export const authSigninAppleContract = defineContract({
  routeName: "auth.signin_apple.post",
  method: "POST",
  path: "/v2/auth/signin/apple",
  query: z.object({}).strict(),
  body: AuthSigninAppleBodySchema,
  response: AuthSigninAppleResponseSchema
});
