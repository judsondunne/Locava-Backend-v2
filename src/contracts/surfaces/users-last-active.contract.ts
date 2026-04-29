import { z } from "zod";
import { defineContract } from "../conventions.js";

export const UsersLastActiveParamsSchema = z.object({
  userId: z.string().min(1)
});

export const UsersLastActiveResponseSchema = z.object({
  routeName: z.literal("users.lastactive.get"),
  requestKey: z.string(),
  userId: z.string(),
  lastActiveMs: z.number().int().nonnegative().nullable()
});

export const usersLastActiveContract = defineContract({
  method: "GET",
  path: "/v2/users/:userId/last-active",
  routeName: "users.lastactive.get",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: UsersLastActiveResponseSchema
});

export type UsersLastActiveResponse = z.infer<typeof UsersLastActiveResponseSchema>;

