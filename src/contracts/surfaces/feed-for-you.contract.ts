import { z } from "zod";
import { defineContract } from "../conventions.js";
import { FeedBootstrapItemSchema } from "./feed-bootstrap.contract.js";

export const FeedForYouQuerySchema = z.object({
  viewerId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  cursor: z.string().optional(),
  debug: z
    .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")])
    .optional()
});

export const FeedForYouDebugSchema = z.object({
  requestId: z.string(),
  viewerId: z.string(),
  engineVersion: z.literal("queue-reels-v1"),
  returnedCount: z.number().int().nonnegative(),
  reelCount: z.number().int().nonnegative(),
  regularCount: z.number().int().nonnegative(),
  recycledRegularCount: z.number().int().nonnegative(),
  feedStateCreated: z.boolean(),
  reelQueueReadCount: z.number().int().nonnegative(),
  reelQueueConsumed: z.number().int().nonnegative(),
  feedStateWriteOk: z.boolean(),
  servedWriteCount: z.number().int().nonnegative(),
  servedWriteOk: z.boolean(),
  regularWindowFetched: z.number().int().nonnegative(),
  emptyReason: z.string().nullable(),
  latencyMs: z.number().nonnegative(),
  reelQueueIndexBefore: z.number().int().nonnegative(),
  reelQueueIndexAfter: z.number().int().nonnegative()
});

export const FeedForYouResponseSchema = z.object({
  routeName: z.literal("feed.for_you.get"),
  requestId: z.string(),
  items: z.array(FeedBootstrapItemSchema),
  nextCursor: z.string().nullable(),
  exhausted: z.boolean(),
  feedState: z.object({
    mode: z.enum(["reels", "mixed", "regular"]),
    reelQueueIndex: z.number().int().nonnegative(),
    reelQueueCount: z.number().int().nonnegative(),
    remainingReels: z.number().int().nonnegative()
  }),
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
