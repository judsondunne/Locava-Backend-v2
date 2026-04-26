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
      role: z.string()
    }),
    session: z.object({
      state: z.enum(["active", "anonymous"]),
      issuedAt: z.string(),
      expiresAt: z.string()
    })
  }),
  deferred: z.object({
    viewerSummary: z
      .object({
        handle: z.string(),
        badge: z.string()
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
