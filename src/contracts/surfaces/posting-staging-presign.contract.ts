import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostingStagingPresignBodySchema = z.object({
  sessionId: z.string().min(4).max(200),
  items: z
    .array(
      z.object({
        index: z.coerce.number().int().min(0).max(79),
        assetType: z.enum(["photo", "video"]),
        destinationKey: z.string().min(3).max(512).optional()
      })
    )
    .min(1)
    .max(40)
});

export const PostingStagingPresignResponseSchema = z.object({
  routeName: z.literal("posting.stagingpresign.post"),
  sessionId: z.string(),
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

export const postingStagingPresignContract = defineContract({
  routeName: "posting.stagingpresign.post",
  method: "POST",
  path: "/v2/posting/staging/presign",
  query: z.object({}).strict(),
  body: PostingStagingPresignBodySchema,
  response: PostingStagingPresignResponseSchema
});
