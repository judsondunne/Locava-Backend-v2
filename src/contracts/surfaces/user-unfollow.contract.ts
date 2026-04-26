import { z } from "zod";
import { defineContract } from "../conventions.js";

export const UserUnfollowParamsSchema = z.object({
  userId: z.string().min(6)
});

export const UserUnfollowResponseSchema = z.object({
  routeName: z.literal("users.unfollow.post"),
  userId: z.string(),
  following: z.boolean(),
  invalidation: z.object({
    invalidatedKeysCount: z.number().int().nonnegative(),
    invalidationTypes: z.array(z.string())
  })
});

export const userUnfollowContract = defineContract({
  routeName: "users.unfollow.post",
  method: "POST",
  path: "/v2/users/:userId/unfollow",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: UserUnfollowResponseSchema
});
