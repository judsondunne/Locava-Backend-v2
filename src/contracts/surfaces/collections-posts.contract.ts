import { z } from "zod";
import { defineContract } from "../conventions.js";
import { PostCardSummarySchema } from "../entities/post-entities.contract.js";

export const CollectionsPostsParamsSchema = z.object({
  collectionId: z.string().trim().min(1),
});

export const CollectionsPostsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(12),
});

export const CollectionsPostsResponseSchema = z.object({
  routeName: z.literal("collections.posts.get"),
  requestKey: z.string(),
  page: z.object({
    cursorIn: z.string().nullable(),
    limit: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    sort: z.literal("saved_at_desc"),
  }),
  items: z.array(PostCardSummarySchema),
  postIds: z.array(z.string()),
  degraded: z.boolean(),
  fallbacks: z.array(z.string()),
});

export const collectionsPostsContract = defineContract({
  routeName: "collections.posts.get",
  method: "GET",
  path: "/v2/collections/:collectionId/posts",
  query: CollectionsPostsQuerySchema,
  body: z.object({}).strict(),
  response: CollectionsPostsResponseSchema,
});
