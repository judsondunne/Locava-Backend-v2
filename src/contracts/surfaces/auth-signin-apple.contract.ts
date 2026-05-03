import { z } from "zod";
import { defineContract } from "../conventions.js";

export const AuthSigninAppleBodySchema = z.object({
  identityToken: z.string().min(1),
  /**
   * Raw (unhashed) Sign in with Apple nonce. Must match what was SHA256-hashed and passed to `AppleAuthentication.signInAsync({ nonce })`.
   * Required for Firebase REST verification when the Apple ID token includes a nonce claim.
   */
  rawNonce: z.string().trim().min(8).max(256).optional(),
  authorizationCode: z.string().optional(),
  email: z.string().trim().email().optional(),
  fullName: z.union([z.string(), z.object({ givenName: z.string().optional(), familyName: z.string().optional() })]).optional(),
  authIntent: z.enum(["sign_in", "sign_up"]).optional(),
  branchData: z.record(z.unknown()).nullable().optional()
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
  errorCode: z.string().optional()
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
