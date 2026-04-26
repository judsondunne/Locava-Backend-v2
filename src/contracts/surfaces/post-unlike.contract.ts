import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostUnlikeParamsSchema = z.object({
  postId: z.string().min(6)
});

export const PostUnlikeResponseSchema = z.object({
  routeName: z.literal("posts.unlike.post"),
  postId: z.string(),
  liked: z.boolean(),
  invalidation: z.object({
    invalidatedKeysCount: z.number().int().nonnegative(),
    invalidationTypes: z.array(z.string())
  })
});

export const postUnlikeContract = defineContract({
  routeName: "posts.unlike.post",
  method: "POST",
  path: "/v2/posts/:postId/unlike",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: PostUnlikeResponseSchema
});
