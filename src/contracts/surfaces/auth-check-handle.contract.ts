import { z } from "zod";
import { defineContract } from "../conventions.js";

export const AuthCheckHandleQuerySchema = z.object({
  handle: z.string().trim().min(1).max(40),
});

export const AuthCheckHandleResponseSchema = z.object({
  routeName: z.literal("auth.check_handle.get"),
  success: z.boolean(),
  available: z.boolean(),
  normalizedHandle: z.string(),
});

export const authCheckHandleContract = defineContract({
  routeName: "auth.check_handle.get",
  method: "GET",
  path: "/v2/auth/check-handle",
  query: AuthCheckHandleQuerySchema,
  body: z.object({}).strict(),
  response: AuthCheckHandleResponseSchema,
});
