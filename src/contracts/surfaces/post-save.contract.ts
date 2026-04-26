import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostSaveParamsSchema = z.object({
  postId: z.string().min(6)
});

export const PostSaveResponseSchema = z.object({
  routeName: z.literal("posts.save.post"),
  postId: z.string(),
  saved: z.boolean(),
  invalidation: z.object({
    invalidatedKeysCount: z.number().int().nonnegative(),
    invalidationTypes: z.array(z.string())
  })
});

export const postSaveContract = defineContract({
  routeName: "posts.save.post",
  method: "POST",
  path: "/v2/posts/:postId/save",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: PostSaveResponseSchema
});
