import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostsMediaCompleteBodySchema = z.object({
  stageId: z.string().min(6),
  items: z
    .array(
      z.object({
        assetIndex: z.coerce.number().int().min(0).max(79),
        assetType: z.enum(["photo", "video"]),
        objectKey: z.string().min(3).max(512).optional()
      })
    )
    .min(1)
    .max(40)
});

export const PostsMediaCompleteResponseSchema = z.object({
  routeName: z.literal("posts.mediacomplete.post"),
  stageId: z.string(),
  ready: z.boolean(),
  completedAssetCount: z.number().int().nonnegative(),
  missingKeys: z.array(z.string())
});

export const postsMediaCompleteContract = defineContract({
  routeName: "posts.mediacomplete.post",
  method: "POST",
  path: "/v2/posts/media/complete",
  query: z.object({}).strict(),
  body: PostsMediaCompleteBodySchema,
  response: PostsMediaCompleteResponseSchema
});
