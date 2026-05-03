import { z } from "zod";
import { defineContract } from "../conventions.js";

export const AuthPushTokenBodySchema = z
  .object({
    expoPushToken: z.string().trim().min(1).optional(),
    pushToken: z.string().trim().min(1).optional(),
    pushTokenPlatform: z.string().trim().min(1).optional()
  })
  .strict()
  .refine((b) => Boolean(b.expoPushToken?.length || b.pushToken?.length), {
    message: "expoPushToken or pushToken required"
  });

export const AuthPushTokenResponseSchema = z.object({
  routeName: z.literal("auth.push_token.post"),
  success: z.boolean(),
  persisted: z.boolean().optional(),
  error: z.string().optional()
});

export const authPushTokenContract = defineContract({
  routeName: "auth.push_token.post",
  method: "POST",
  path: "/v2/auth/push-token",
  query: z.object({}).strict(),
  body: AuthPushTokenBodySchema,
  response: AuthPushTokenResponseSchema
});
