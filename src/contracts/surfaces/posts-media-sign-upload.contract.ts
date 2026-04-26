import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostsMediaSignUploadBodySchema = z.object({
  stageId: z.string().min(6),
  items: z
    .array(
      z.object({
        assetIndex: z.coerce.number().int().min(0).max(79),
        assetType: z.enum(["photo", "video"]),
        destinationKey: z.string().min(3).max(512).optional()
      })
    )
    .min(1)
    .max(40)
});

export const PostsMediaSignUploadResponseSchema = z.object({
  routeName: z.literal("posts.mediasignupload.post"),
  stageId: z.string(),
  urls: z.array(
    z.object({
      index: z.number().int(),
      uploadUrl: z.string().url(),
      key: z.string(),
      contentType: z.string(),
      assetId: z.string(),
      originalKey: z.string(),
      originalUrl: z.string().url(),
      posterKey: z.string().optional(),
      posterUrl: z.string().url().optional()
    })
  )
});

export const postsMediaSignUploadContract = defineContract({
  routeName: "posts.mediasignupload.post",
  method: "POST",
  path: "/v2/posts/media/sign-upload",
  query: z.object({}).strict(),
  body: PostsMediaSignUploadBodySchema,
  response: PostsMediaSignUploadResponseSchema
});
