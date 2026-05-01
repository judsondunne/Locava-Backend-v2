import { z } from "zod";
import { defineContract } from "../conventions.js";

export const AuthSigninAppleBodySchema = z.object({
  identityToken: z.string().min(1),
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
  token: z.string().optional(),
  oauthInfo: AuthAppleOauthInfoSchema.optional(),
  error: z.string().optional()
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
