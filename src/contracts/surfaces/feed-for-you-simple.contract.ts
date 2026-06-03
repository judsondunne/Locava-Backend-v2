import { z } from "zod";
import { defineContract } from "../conventions.js";
import { PostCardSummarySchema } from "../entities/post-entities.contract.js";

/**
 * Radius mode for For You feed:
 * - "global": no geographic filter (default, unchanged behavior)
 * - "nearMe": filter by viewer current location (clientLat/clientLng required)
 * - "custom": filter by a specific saved/searched location (centerLat/centerLng required)
 *
 * radiusMiles is bounded server-side ([1, 500]) and only used when radiusMode != "global".
 */
export const FeedForYouSimpleRadiusSchema = z
  .object({
    radiusMode: z.enum(["global", "nearMe", "custom"]).default("global"),
    centerLat: z.coerce.number().min(-90).max(90).optional(),
    centerLng: z.coerce.number().min(-180).max(180).optional(),
    radiusMiles: z.coerce.number().min(1).max(500).optional()
  })
  .partial();

/**
 * Maximum number of client-supplied excludeIds accepted per request. The
 * client cap is the same. Anything past this is silently dropped so a
 * misbehaving client can't enlarge the request beyond Cloud Run limits.
 */
export const FOR_YOU_SIMPLE_EXCLUDE_IDS_MAX = 200;

const ExcludeIdsTransform = z
  .union([z.string(), z.array(z.string())])
  .transform((raw) => {
    const tokens = Array.isArray(raw) ? raw : String(raw).split(",");
    const seen = new Set<string>();
    const out: string[] = [];
    for (const token of tokens) {
      const t = String(token ?? "").trim();
      if (!t) continue;
      if (t.length > 64) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= FOR_YOU_SIMPLE_EXCLUDE_IDS_MAX) break;
    }
    return out;
  });

export const FeedForYouSimpleQuerySchema = z.object({
  viewerId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(12).default(5),
  cursor: z.string().optional(),
  /** When true, ignore cursor and start a fresh window (client retry / recovery). */
  refresh: z.coerce.boolean().optional(),
  /** Read-only verification: do not write compact feedState seen merges. */
  dryRunSeen: z.coerce.boolean().optional(),
  /** When true, response debug may include extra V5 diagnostics (bounded). */
  debug: z.coerce.boolean().optional(),
  /**
   * Optional safety net: extra post IDs the client wants excluded from this response
   * (e.g. recently-served IDs persisted on-device). Backed by Native's `forYouRecentSeenStore`.
   * Accepts a comma-separated list or repeated query param. Capped at FOR_YOU_SIMPLE_EXCLUDE_IDS_MAX.
   * Layered on top of durable seen + session seen; never replaces them.
   */
  excludeIds: ExcludeIdsTransform.optional(),
  /** Radius filter mode; only "nearMe" / "custom" alter behavior. Defaults to "global". */
  radiusMode: z.enum(["global", "nearMe", "custom"]).optional(),
  centerLat: z.coerce.number().min(-90).max(90).optional(),
  centerLng: z.coerce.number().min(-180).max(180).optional(),
  /** Bounded radius (1-500 miles). Required when radiusMode != "global". */
  radiusMiles: z.coerce.number().min(1).max(500).optional()
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
  durableServedWriteStatus: z.enum(["ok", "skipped", "error", "deferred"]).optional(),
  firstPaintPlaybackReadyCount: z.number().int().nonnegative().optional(),
  firstVisiblePlaybackUrlPresent: z.boolean().optional(),
  firstVisiblePosterPresent: z.boolean().optional(),
  firstVisibleVariant: z.string().nullable().optional(),
  firstVisibleNeedsDetailBeforePlay: z.boolean().optional(),
  deckStarvationRefillUsed: z.boolean().optional(),
  softServedRecentPicks: z.number().int().nonnegative().optional(),
  /** Count of post IDs the client asked us to exclude this request (`excludeIds` param). */
  clientExcludeIdsCount: z.number().int().nonnegative().optional(),
  /** Count of candidates skipped because they matched a client-supplied excludeIds entry. */
  clientExcludeIdsFiltered: z.number().int().nonnegative().optional(),
  /** Radius filter diagnostics (always present; "global" mode echoes radiusMode only). */
  radiusFilter: z
    .object({
      mode: z.enum(["global", "nearMe", "custom"]),
      radiusMiles: z.number().min(1).max(500).nullable(),
      hasCenter: z.boolean(),
      candidateCount: z.number().int().nonnegative(),
      filteredOutCount: z.number().int().nonnegative(),
      cursorCarriesFilter: z.boolean(),
      deckKeyHash: z.string().nullable()
    })
    .optional()
})
  .merge(
    z
      .object({
        forYouRouteVariant: z.enum(["v5", "legacy"]).optional(),
        legacyReason: z.string().optional(),
        routeEnteredV5: z.boolean().optional(),
        cursorType: z.string().optional(),
        dryRunSeen: z.boolean().optional(),
        seenWritesEnabled: z.boolean().optional(),
        returnedPostIds: z.array(z.string()).optional(),
        duplicateReturnedPostIds: z.array(z.string()).optional(),
        repeatRisk: z.string().nullable().optional(),
        cacheStatus: z.string().optional(),
        dbReadEstimate: z.number().nonnegative().optional(),
        durableSeenRead: z.boolean().optional(),
        seenWriteSkippedReason: z.string().nullable().optional(),
        regularFallbackUsed: z.boolean().optional(),
        reelsRemainingEstimate: z.number().int().nonnegative().optional()
      })
      .partial()
  );

export const FeedForYouSimpleResponseSchema = z.object({
  routeName: z.literal("feed.for_you_simple.get"),
  items: z.array(PostCardSummarySchema),
  nextCursor: z.string().nullable(),
  /** True when no next page exists for this viewer under normal lanes (legacy; prefer hasMore + lane). */
  exhausted: z.boolean(),
  /** High-level lane for this page (two-lane contract + recycle). */
  lane: z.enum(["reels", "normal", "recycled"]),
  /** True when every reel-tier phase has no further unseen candidates (cursor state). */
  exhaustedReels: z.boolean(),
  /** True when the normal/fallback phase has no further unseen candidates. */
  exhaustedNormal: z.boolean(),
  /** More pages available for this viewer (nextCursor or recycle continues). */
  hasMore: z.boolean(),
  emptyReason: z.union([z.literal("no_playable_posts"), z.null()]),
  degradedFallbackUsed: z.boolean(),
  relaxedSeenUsed: z.boolean(),
  wrapAroundUsed: z.boolean(),
  fallbackAllPostsUsed: z.boolean(),
  emergencyFallbackUsed: z.boolean(),
  /** When true, Native may show end-of-feed; when false/omitted with empty page, keep paging/recovery. */
  terminalExhaustionConfirmed: z.boolean().optional(),
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
