import { z } from "zod";
import { defineContract } from "../conventions.js";

export const AuthRegisterBodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(6),
  displayName: z.string().trim().min(1).max(80).optional()
});

export const AuthRegisterResponseSchema = z.object({
  routeName: z.literal("auth.register.post"),
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

// invalidation: register creates a new auth session and changes downstream bootstrap state.
export const authRegisterContract = defineContract({
  routeName: "auth.register.post",
  method: "POST",
  path: "/v2/auth/register",
  query: z.object({}).strict(),
  body: AuthRegisterBodySchema,
  response: AuthRegisterResponseSchema
});
