import { z } from "zod";
import { defineContract } from "../conventions.js";

export const AuthSessionQuerySchema = z.object({
  debugSlowDeferredMs: z.coerce.number().int().min(0).max(2000).default(0)
});

export const AuthSessionResponseSchema = z.object({
  routeName: z.literal("auth.session.get"),
  firstRender: z.object({
    authenticated: z.boolean(),
    viewer: z.object({
      id: z.string(),
      uid: z.string().optional(),
        canonicalUserId: z.string().optional(),
      role: z.string(),
      email: z.string().nullable().optional(),
      handle: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
        photoUrl: z.string().nullable().optional(),
        profilePicSmallPath: z.string().nullable().optional(),
        profilePicMediumPath: z.string().nullable().optional(),
        profilePicLargePath: z.string().nullable().optional()
    }),
    session: z.object({
      state: z.enum(["active", "anonymous"]),
      issuedAt: z.string(),
      expiresAt: z.string()
    }),
    account: z.object({
      status: z.enum(["existing_complete", "existing_incomplete", "new_account_required"]).nullable(),
      onboardingComplete: z.boolean().nullable(),
      viewerReady: z.boolean(),
      profileHydrationStatus: z.enum(["ready", "minimal_fallback"]),
      retryAfterMs: z.number().int().positive().nullable().optional(),
      reason: z.string().nullable().optional()
    })
  }),
  deferred: z.object({
    viewerSummary: z
      .object({
        uid: z.string(),
        canonicalUserId: z.string(),
        viewerReady: z.boolean(),
        profileHydrationStatus: z.enum(["ready", "minimal_fallback"]),
        email: z.string().nullable(),
        handle: z.string(),
        name: z.string().nullable(),
        profilePic: z.string().nullable(),
        profilePicSmallPath: z.string().nullable(),
        profilePicMediumPath: z.string().nullable(),
        profilePicLargePath: z.string().nullable(),
        badge: z.string(),
        onboardingComplete: z.boolean().nullable().optional()
      })
      .nullable()
  }),
  background: z.object({
    cacheWarmScheduled: z.boolean()
  }),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const authSessionContract = defineContract({
  routeName: "auth.session.get",
  method: "GET",
  path: "/v2/auth/session",
  query: AuthSessionQuerySchema,
  body: z.object({}).strict(),
  response: AuthSessionResponseSchema
});

export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;
