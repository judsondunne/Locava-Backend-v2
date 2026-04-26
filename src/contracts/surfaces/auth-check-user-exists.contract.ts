import { z } from "zod";
import { defineContract } from "../conventions.js";

export const AuthCheckUserExistsQuerySchema = z.object({
  email: z.string().trim().email(),
});

export const AuthCheckUserExistsResponseSchema = z.object({
  routeName: z.literal("auth.check_user_exists.get"),
  success: z.boolean(),
  exists: z.boolean(),
  signInMethods: z.array(z.string()).optional(),
  error: z.string().optional(),
});

export const authCheckUserExistsContract = defineContract({
  routeName: "auth.check_user_exists.get",
  method: "GET",
  path: "/v2/auth/check-user-exists",
  query: AuthCheckUserExistsQuerySchema,
  body: z.object({}).strict(),
  response: AuthCheckUserExistsResponseSchema,
});
