import { z } from "zod";
import { defineContract } from "../conventions.js";
import { FeedBootstrapItemSchema } from "./feed-bootstrap.contract.js";

export const FeedForYouQuerySchema = z.object({
  viewerId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(4).max(12).default(8),
  cursor: z.string().optional(),
  debug: z
    .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")])
    .optional()
});

export const FeedForYouDebugSchema = z.object({
  requestId: z.string(),
  viewerId: z.string(),
  requestedLimit: z.number().int().positive(),
  returnedCount: z.number().int().nonnegative(),
  reelCount: z.number().int().nonnegative(),
  regularCount: z.number().int().nonnegative(),
  recycledCount: z.number().int().nonnegative(),
  candidateWindowSizes: z.object({
    reels: z.number().int().nonnegative(),
    regular: z.number().int().nonnegative(),
    regularFallback: z.number().int().nonnegative()
  }),
  servedCheckedCount: z.number().int().nonnegative(),
  servedDroppedCount: z.number().int().nonnegative(),
  servedWriteCount: z.number().int().nonnegative(),
  servedWriteOk: z.boolean(),
  queryCountEstimate: z.number().int().nonnegative(),
  budgetCapped: z.boolean(),
  latencyMs: z.number().nonnegative(),
  readEstimate: z.number().int().nonnegative(),
  rankingVersion: z.string(),
  emptyReason: z.string().nullable(),
  cursorInfo: z.object({
    page: z.number().int().nonnegative(),
    reelCursorTime: z.number().nullable(),
    reelCursorPostId: z.string().nullable(),
    regularCursorTime: z.number().nullable(),
    regularCursorPostId: z.string().nullable(),
    recycleMode: z.boolean().optional()
  })
});

export const FeedForYouResponseSchema = z.object({
  routeName: z.literal("feed.for_you.get"),
  requestId: z.string(),
  items: z.array(FeedBootstrapItemSchema),
  nextCursor: z.string().nullable(),
  exhausted: z.boolean(),
  debug: FeedForYouDebugSchema.optional()
});

export const feedForYouContract = defineContract({
  routeName: "feed.for_you.get",
  method: "GET",
  path: "/v2/feed/for-you",
  query: FeedForYouQuerySchema,
  body: z.object({}).strict(),
  response: FeedForYouResponseSchema
});

export type FeedForYouResponse = z.infer<typeof FeedForYouResponseSchema>;
