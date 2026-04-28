import { z } from "zod";
import { defineContract } from "../conventions.js";

export const SocialBatchItemSchema = z.object({
  postId: z.string(),
  likeCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  viewerHasLiked: z.boolean(),
  viewerHasSaved: z.boolean()
});

export const SocialBatchQuerySchema = z
  .object({
    postIds: z.union([z.string(), z.array(z.string())]).optional()
  })
  .passthrough();

export const SocialBatchResponseSchema = z.object({
  routeName: z.literal("social.batch.get"),
  items: z.array(SocialBatchItemSchema)
});

export const socialBatchContract = defineContract({
  routeName: "social.batch.get",
  method: "GET",
  path: "/v2/social/batch",
  query: SocialBatchQuerySchema,
  body: z.object({}).strict(),
  response: SocialBatchResponseSchema
});

export type SocialBatchResponse = z.infer<typeof SocialBatchResponseSchema>;
