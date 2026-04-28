import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostLikeParamsSchema = z.object({
  postId: z.string().min(6)
});

export const PostLikeResponseSchema = z.object({
  routeName: z.literal("posts.like.post"),
  postId: z.string(),
  liked: z.boolean(),
  likeCount: z.number().int().nonnegative(),
  viewerState: z.object({ liked: z.boolean() }),
  idempotency: z.object({ replayed: z.boolean() }),
  invalidation: z.object({
    invalidatedKeysCount: z.number().int().nonnegative(),
    invalidationTypes: z.array(z.string())
  })
});

export const postLikeContract = defineContract({
  routeName: "posts.like.post",
  method: "POST",
  path: "/v2/posts/:postId/like",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: PostLikeResponseSchema
});
