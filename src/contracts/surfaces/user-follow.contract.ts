import { z } from "zod";
import { defineContract } from "../conventions.js";

export const UserFollowParamsSchema = z.object({
  userId: z.string().min(6)
});

export const UserFollowResponseSchema = z.object({
  routeName: z.literal("users.follow.post"),
  userId: z.string(),
  following: z.boolean(),
  invalidation: z.object({
    invalidatedKeysCount: z.number().int().nonnegative(),
    invalidationTypes: z.array(z.string())
  })
});

export const userFollowContract = defineContract({
  routeName: "users.follow.post",
  method: "POST",
  path: "/v2/users/:userId/follow",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: UserFollowResponseSchema
});
