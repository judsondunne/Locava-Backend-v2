import { z } from "zod";
import { defineContract } from "../conventions.js";

export const AuthProfileCreateBodySchema = z.object({
  userId: z.string().min(1),
  /** Login identity for email/password users; also accepted for OAuth when clients send it explicitly. */
  email: z.string().trim().email().optional(),
  name: z.string().trim().min(1).max(80),
  age: z.number().int().min(13).max(120),
  explorerLevel: z.string().optional(),
  activityProfile: z.union([z.array(z.string()), z.record(z.number())]).optional(),
  selectedActivities: z.array(z.string()).optional(),
  profilePicture: z.string().optional(),
  phoneNumber: z.string().optional(),
  school: z.string().optional(),
  handle: z.string().trim().min(1).max(40).optional(),
  relationshipRef: z.string().optional(),
  branchData: z.record(z.unknown()).nullable().optional(),
  expoPushToken: z.string().trim().min(1).optional(),
  pushToken: z.string().trim().min(1).optional(),
  pushTokenPlatform: z.string().trim().min(1).optional(),
  oauthInfo: z
    .object({
      provider: z.enum(["google", "apple"]),
      providerId: z.string().min(1),
      email: z.string().trim().email().optional(),
      displayName: z.string().optional()
    })
    .optional()
});

export const AuthProfileCreateResponseSchema = z.object({
  routeName: z.literal("auth.profile_create.post"),
  success: z.literal(true),
  handle: z.string(),
  storage: z.enum(["firestore", "local_state_fallback"]),
  token: z.string().optional()
});

// invalidation: profile create invalidates empty-onboarding state and makes auth/session + profile bootstrap resolvable.
export const authProfileCreateContract = defineContract({
  routeName: "auth.profile_create.post",
  method: "POST",
  path: "/v2/auth/profile",
  query: z.object({}).strict(),
  body: AuthProfileCreateBodySchema,
  response: AuthProfileCreateResponseSchema
});
