import { z } from "zod";
import { defineContract } from "../conventions.js";

export const AuthSigninGoogleBodySchema = z.object({
  accessToken: z.string().min(1),
  authIntent: z.enum(["sign_in", "sign_up"]).optional(),
  branchData: z.record(z.unknown()).nullable().optional()
});

const AuthOauthInfoSchema = z.object({
  provider: z.literal("google"),
  providerId: z.string().min(1),
  email: z.string().trim().email().optional(),
  displayName: z.string().optional()
});

const AccountStatusSchema = z.enum([
  "existing_complete",
  "existing_incomplete",
  "new_account_required"
]);

export const AuthSigninGoogleResponseSchema = z.object({
  routeName: z.literal("auth.signin_google.post"),
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
  oauthInfo: AuthOauthInfoSchema.optional(),
  error: z.string().optional()
});

// invalidation: Google sign-in changes auth session state and may branch into profile bootstrap/onboarding.
export const authSigninGoogleContract = defineContract({
  routeName: "auth.signin_google.post",
  method: "POST",
  path: "/v2/auth/signin/google",
  query: z.object({}).strict(),
  body: AuthSigninGoogleBodySchema,
  response: AuthSigninGoogleResponseSchema
});
