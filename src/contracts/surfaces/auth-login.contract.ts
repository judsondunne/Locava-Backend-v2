import { z } from "zod";
import { defineContract } from "../conventions.js";

export const AuthLoginBodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  authIntent: z.enum(["sign_in", "sign_up"]).optional(),
  branchData: z.record(z.unknown()).nullable().optional()
});

export const AuthLoginResponseSchema = z.object({
  routeName: z.literal("auth.login.post"),
  success: z.boolean(),
  user: z
    .object({
      uid: z.string(),
      email: z.string().optional(),
      displayName: z.string().optional()
    })
    .optional(),
  token: z.string().optional(),
  error: z.string().optional()
});

// invalidation: login refreshes client auth state and subsequent auth/session + profile bootstrap reads.
export const authLoginContract = defineContract({
  routeName: "auth.login.post",
  method: "POST",
  path: "/v2/auth/login",
  query: z.object({}).strict(),
  body: AuthLoginBodySchema,
  response: AuthLoginResponseSchema
});
