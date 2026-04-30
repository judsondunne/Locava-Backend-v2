import { z } from "zod";
import { defineContract } from "../conventions.js";

export const AuthDeleteAccountBodySchema = z.object({}).strict();

export const AuthDeleteAccountResponseSchema = z.object({
  routeName: z.literal("auth.delete_account.post"),
  success: z.boolean(),
  deletedUserDoc: z.boolean().optional(),
  deletedAuthUser: z.boolean().optional(),
  revokedSessions: z.boolean().optional(),
  error: z.string().optional()
});

export const authDeleteAccountContract = defineContract({
  routeName: "auth.delete_account.post",
  method: "POST",
  path: "/v2/auth/delete-account",
  query: z.object({}).strict(),
  body: AuthDeleteAccountBodySchema,
  response: AuthDeleteAccountResponseSchema
});
