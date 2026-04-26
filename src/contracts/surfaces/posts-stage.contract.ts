import { z } from "zod";
import { defineContract } from "../conventions.js";

const StageAssetSchema = z.object({
  assetIndex: z.coerce.number().int().min(0).max(79),
  assetType: z.enum(["photo", "video"]),
  contentType: z.string().min(3).max(120).optional(),
  destinationKey: z.string().min(3).max(512).optional()
});

export const PostsStageBodySchema = z.object({
  clientMutationId: z.string().min(8).max(128),
  title: z.string().max(200).optional(),
  caption: z.string().max(5000).optional(),
  activities: z.array(z.string().min(1).max(80)).max(32).default([]),
  privacy: z.enum(["Public Spot", "Friends Spot", "Secret Spot"]).default("Public Spot"),
  lat: z.coerce.number().min(-90).max(90).nullable().optional(),
  long: z.coerce.number().min(-180).max(180).nullable().optional(),
  address: z.string().max(300).optional(),
  tags: z.array(z.string().min(1).max(80)).max(64).default([]),
  assets: z.array(StageAssetSchema).min(1).max(20)
});

export const PostsStageResponseSchema = z.object({
  routeName: z.literal("posts.stage.post"),
  stage: z.object({
    stageId: z.string(),
    viewerId: z.string(),
    state: z.enum(["staged", "publishing", "published", "cancelled", "failed"]),
    createdAtMs: z.number().int().positive(),
    updatedAtMs: z.number().int().positive(),
    expiresAtMs: z.number().int().positive()
  }),
  idempotency: z.object({
    replayed: z.boolean()
  })
});

export const postsStageContract = defineContract({
  routeName: "posts.stage.post",
  method: "POST",
  path: "/v2/posts/stage",
  query: z.object({}).strict(),
  body: PostsStageBodySchema,
  response: PostsStageResponseSchema
});
