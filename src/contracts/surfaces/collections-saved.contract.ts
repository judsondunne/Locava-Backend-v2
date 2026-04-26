import { z } from "zod";
import { defineContract } from "../conventions.js";
import { PostCardSummarySchema } from "../entities/post-entities.contract.js";

export const CollectionsSavedQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(6).max(20).default(12)
});

export const CollectionsSavedResponseSchema = z.object({
  routeName: z.literal("collections.saved.get"),
  requestKey: z.string(),
  page: z.object({
    cursorIn: z.string().nullable(),
    limit: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    sort: z.literal("saved_at_desc")
  }),
  items: z.array(PostCardSummarySchema),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const collectionsSavedContract = defineContract({
  routeName: "collections.saved.get",
  method: "GET",
  path: "/v2/collections/saved",
  query: CollectionsSavedQuerySchema,
  body: z.object({}).strict(),
  response: CollectionsSavedResponseSchema
});

export type CollectionsSavedResponse = z.infer<typeof CollectionsSavedResponseSchema>;
