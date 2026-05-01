import { z } from "zod";
import { defineContract } from "../conventions.js";
import { PostCardSummarySchema } from "../entities/post-entities.contract.js";

export const FeedForYouSimpleQuerySchema = z.object({
  viewerId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(10).default(5),
  cursor: z.string().optional()
});

export const FeedForYouSimpleDebugSchema = z.object({
  source: z.literal("firestore_random_simple"),
  requestedLimit: z.number().int().positive(),
  returnedCount: z.number().int().nonnegative(),
  cursorUsed: z.boolean(),
  randomSeedOrAnchor: z.string().optional(),
  dbReads: z.number().int().nonnegative().optional(),
  elapsedMs: z.number().nonnegative().optional()
});

export const FeedForYouSimpleResponseSchema = z.object({
  routeName: z.literal("feed.for_you_simple.get"),
  items: z.array(PostCardSummarySchema),
  nextCursor: z.string().nullable(),
  debug: FeedForYouSimpleDebugSchema
});

export const feedForYouSimpleContract = defineContract({
  routeName: "feed.for_you_simple.get",
  method: "GET",
  path: "/v2/feed/for-you/simple",
  query: FeedForYouSimpleQuerySchema,
  body: z.object({}).strict(),
  response: FeedForYouSimpleResponseSchema
});

export type FeedForYouSimpleResponse = z.infer<typeof FeedForYouSimpleResponseSchema>;
