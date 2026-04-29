import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostDeleteParamsSchema = z.object({
  postId: z.string().min(6)
});

export const PostDeleteResponseSchema = z.object({
  routeName: z.literal("posts.delete"),
  postId: z.string(),
  deleted: z.boolean(),
  idempotency: z.object({ replayed: z.boolean() }),
  invalidation: z.object({
    invalidatedKeysCount: z.number().int().nonnegative(),
    invalidationTypes: z.array(z.string())
  })
});

export const postDeleteContract = defineContract({
  routeName: "posts.delete",
  method: "DELETE",
  path: "/v2/posts/:postId",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: PostDeleteResponseSchema
});

