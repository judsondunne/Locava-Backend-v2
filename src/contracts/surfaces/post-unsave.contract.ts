import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostUnsaveParamsSchema = z.object({
  postId: z.string().min(6)
});

export const PostUnsaveResponseSchema = z.object({
  routeName: z.literal("posts.unsave.post"),
  postId: z.string(),
  saved: z.boolean(),
  invalidation: z.object({
    invalidatedKeysCount: z.number().int().nonnegative(),
    invalidationTypes: z.array(z.string())
  })
});

export const postUnsaveContract = defineContract({
  routeName: "posts.unsave.post",
  method: "POST",
  path: "/v2/posts/:postId/unsave",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: PostUnsaveResponseSchema
});
