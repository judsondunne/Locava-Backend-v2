import { z } from "zod";
import { defineContract } from "../conventions.js";

export const AuthSignoutBodySchema = z.object({}).strict();

export const AuthSignoutResponseSchema = z.object({
  routeName: z.literal("auth.signout.post"),
  success: z.boolean(),
  clearedPushToken: z.boolean().optional(),
  error: z.string().optional()
});

export const authSignoutContract = defineContract({
  routeName: "auth.signout.post",
  method: "POST",
  path: "/v2/auth/signout",
  query: z.object({}).strict(),
  body: AuthSignoutBodySchema,
  response: AuthSignoutResponseSchema
});
