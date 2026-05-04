import { z } from "zod";
import { defineContract } from "../conventions.js";
import { PostCardSummarySchema } from "../entities/post-entities.contract.js";

export const FeedForYouSimpleQuerySchema = z.object({
  viewerId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(12).default(5),
  cursor: z.string().optional(),
  /** When true, ignore cursor and start a fresh window (client retry / recovery). */
  refresh: z.coerce.boolean().optional()
});

export const FeedForYouSimpleDebugSchema = z.object({
  source: z.literal("firestore_random_simple"),
  requestedLimit: z.number().int().positive(),
  returnedCount: z.number().int().nonnegative(),
  rawReelCandidates: z.number().int().nonnegative(),
  rawFallbackCandidates: z.number().int().nonnegative(),
  filteredBySeen: z.number().int().nonnegative(),
  filteredByBlockedAuthor: z.number().int().nonnegative(),
  filteredByMissingMedia: z.number().int().nonnegative(),
  filteredByInvalidContract: z.number().int().nonnegative(),
  filteredByViewerOwnPost: z.number().int().nonnegative(),
  filteredByCursorWindow: z.number().int().nonnegative(),
  filteredInvisible: z.number().int().nonnegative(),
  relaxedSeenUsed: z.boolean(),
  fallbackAllPostsUsed: z.boolean(),
  wrapAroundUsed: z.boolean(),
  emergencyFallbackUsed: z.boolean(),
  degradedFallbackUsed: z.boolean(),
  mediaReadyCount: z.number().int().nonnegative(),
  degradedMediaCount: z.number().int().nonnegative(),
  missingMediaFilteredCount: z.number().int().nonnegative(),
  nextCursorPresent: z.boolean(),
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
  boundedAttempts: z.number().int().nonnegative(),
  exhaustedUnseenCandidates: z.boolean(),
  recycledSeenPosts: z.boolean(),
  reelFirstEnabled: z.boolean(),
  reelCandidateReadCount: z.number().int().nonnegative(),
  fallbackCandidateReadCount: z.number().int().nonnegative(),
  reelReturnedCount: z.number().int().nonnegative(),
  fallbackReturnedCount: z.number().int().nonnegative(),
  reelPhaseExhausted: z.boolean(),
  dbReads: z.number().int().nonnegative().optional(),
  queryCount: z.number().int().nonnegative().optional(),
  responseDbReads: z.number().int().nonnegative().optional(),
  responseDbWrites: z.number().int().nonnegative().optional(),
  elapsedMs: z.number().nonnegative().optional(),
  deckHit: z.boolean().optional(),
  deckSource: z.enum(["memory", "firestore", "cold_refill", "fallback"]).optional(),
  deckItemsBefore: z.number().int().nonnegative().optional(),
  deckItemsReturned: z.number().int().nonnegative().optional(),
  deckItemsAfter: z.number().int().nonnegative().optional(),
  deckRefillScheduled: z.boolean().optional(),
  deckRefillReason: z.string().nullable().optional(),
  servedRecentFiltered: z.number().int().nonnegative().optional(),
  duplicateSuppressed: z.number().int().nonnegative().optional(),
  noCursorRequest: z.boolean().optional(),
  repeatedFromRecentCount: z.number().int().nonnegative().optional(),
  firstPaintCardReadyCount: z.number().int().nonnegative().optional(),
  detailBatchRequiredForFirstPaint: z.boolean().optional(),
  durableServedWriteStatus: z.enum(["ok", "skipped", "error"]).optional(),
  firstPaintPlaybackReadyCount: z.number().int().nonnegative().optional(),
  firstVisiblePlaybackUrlPresent: z.boolean().optional(),
  firstVisiblePosterPresent: z.boolean().optional(),
  firstVisibleVariant: z.string().nullable().optional(),
  firstVisibleNeedsDetailBeforePlay: z.boolean().optional(),
  deckStarvationRefillUsed: z.boolean().optional(),
  softServedRecentPicks: z.number().int().nonnegative().optional()
});

export const FeedForYouSimpleResponseSchema = z.object({
  routeName: z.literal("feed.for_you_simple.get"),
  items: z.array(PostCardSummarySchema),
  nextCursor: z.string().nullable(),
  exhausted: z.boolean(),
  emptyReason: z.union([z.literal("no_playable_posts"), z.null()]),
  degradedFallbackUsed: z.boolean(),
  relaxedSeenUsed: z.boolean(),
  wrapAroundUsed: z.boolean(),
  fallbackAllPostsUsed: z.boolean(),
  emergencyFallbackUsed: z.boolean(),
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
