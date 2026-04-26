import { z } from "zod";
import { defineContract } from "../conventions.js";
import { PostsDetailResponseSchema } from "./posts-detail.contract.js";
import { PostCardSummarySchema } from "../entities/post-entities.contract.js";

export const PostsPublishBodySchema = z.object({
  stageId: z.string().min(6),
  clientMutationId: z.string().min(8).max(128),
  title: z.string().max(200).optional(),
  caption: z.string().max(5000).optional(),
  activities: z.array(z.string().min(1).max(80)).max(32).default([]),
  privacy: z.enum(["Public Spot", "Friends Spot", "Secret Spot"]).default("Public Spot"),
  lat: z.coerce.number().min(-90).max(90).nullable().optional(),
  long: z.coerce.number().min(-180).max(180).nullable().optional(),
  address: z.string().max(300).optional(),
  tags: z.array(z.string().min(1).max(80)).max(64).default([]),
  texts: z.array(z.unknown()).optional(),
  recordingsList: z.array(z.unknown()).optional()
});

export const PostsPublishResponseSchema = z.object({
  routeName: z.literal("posts.publish.post"),
  stageId: z.string(),
  postId: z.string(),
  idempotency: z.object({
    replayed: z.boolean()
  }),
  detail: PostsDetailResponseSchema,
  card: PostCardSummarySchema
});

export const postsPublishContract = defineContract({
  routeName: "posts.publish.post",
  method: "POST",
  path: "/v2/posts/publish",
  query: z.object({}).strict(),
  body: PostsPublishBodySchema,
  response: PostsPublishResponseSchema
});
