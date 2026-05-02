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
  durableSeenReadCount: z.number().int().nonnegative(),
  cursorSeenCount: z.number().int().nonnegative(),
  candidateReadCount: z.number().int().nonnegative(),
  duplicateFilteredCount: z.number().int().nonnegative(),
  durableSeenFilteredCount: z.number().int().nonnegative(),
  cursorSeenFilteredCount: z.number().int().nonnegative(),
  seenWriteAttempted: z.boolean(),
  seenWriteSucceeded: z.boolean(),
  blockingResponseWrites: z.number().int().nonnegative().optional(),
  deferredWritesQueued: z.number().int().nonnegative().optional(),
  deferredWriterFlushAttempts: z.number().int().nonnegative().optional(),
  deferredWriterSucceededFlushes: z.number().int().nonnegative().optional(),
  deferredWriterFailedFlushes: z.number().int().nonnegative().optional(),
  boundedAttempts: z.number().int().positive(),
  exhaustedUnseenCandidates: z.boolean(),
  recycledSeenPosts: z.literal(false),
  reelFirstEnabled: z.literal(true),
  reelCandidateReadCount: z.number().int().nonnegative(),
  fallbackCandidateReadCount: z.number().int().nonnegative(),
  reelReturnedCount: z.number().int().nonnegative(),
  fallbackReturnedCount: z.number().int().nonnegative(),
  reelPhaseExhausted: z.boolean(),
  dbReads: z.number().int().nonnegative().optional(),
  responseDbReads: z.number().int().nonnegative().optional(),
  responseDbWrites: z.number().int().nonnegative().optional(),
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
