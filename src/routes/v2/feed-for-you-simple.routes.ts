import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { feedForYouSimpleContract, FeedForYouSimpleQuerySchema } from "../../contracts/surfaces/feed-for-you-simple.contract.js";
import { failure, success } from "../../lib/response.js";
import { getRequestContext, setOrchestrationMetadata, setRouteName } from "../../observability/request-context.js";
import { FeedForYouSimpleRepository } from "../../repositories/surfaces/feed-for-you-simple.repository.js";
import { FeedForYouSimpleService } from "../../services/surfaces/feed-for-you-simple.service.js";
import {
  buildFeedItemsMediaTracePayload,
  isFeedItemsMediaTraceEnabled,
  rollupFeedVideoMediaSummary
} from "../../observability/feed-items-media-trace.js";

export async function registerV2FeedForYouSimpleRoutes(app: FastifyInstance): Promise<void> {
  const repository = new FeedForYouSimpleRepository();
  const service = new FeedForYouSimpleService(repository);

  app.get(feedForYouSimpleContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    const query = FeedForYouSimpleQuerySchema.parse(request.query);
    setRouteName(feedForYouSimpleContract.routeName);
    const viewerId = query.viewerId?.trim() || viewer.viewerId || null;
    setOrchestrationMetadata({
      surface: "home_feed",
      requestGroup: query.cursor ? "pagination" : "first_paint",
      priority: query.cursor ? "P1_NEXT_PLAYBACK" : "P0_VISIBLE_PLAYBACK",
      hydrationMode: "card",
    });

    try {
      const startedAt = Date.now();
      const payload = await service.getPage({
        viewerId,
        limit: query.limit,
        cursor: query.cursor ?? null,
        refresh: query.refresh === true
      });
      const ctx = getRequestContext();
      const dbReads = ctx?.dbOps.reads ?? 0;
      const dbWrites = ctx?.dbOps.writes ?? 0;
      const elapsedMs = Date.now() - startedAt;
      const videoSummary = rollupFeedVideoMediaSummary(payload.items) as Record<string, unknown>;

      const summaryPayload = {
        event: "feed_for_you_simple_summary",
        viewerId,
        requestedLimit: query.limit,
        returnedCount: payload.items.length,
        rawReelCandidates: payload.debug.rawReelCandidates,
        rawFallbackCandidates: payload.debug.rawFallbackCandidates,
        filteredBySeen: payload.debug.filteredBySeen,
        filteredByBlockedAuthor: payload.debug.filteredByBlockedAuthor,
        filteredByMissingMedia: payload.debug.filteredByMissingMedia,
        filteredByInvalidContract: payload.debug.filteredByInvalidContract,
        filteredByViewerOwnPost: payload.debug.filteredByViewerOwnPost,
        filteredByCursorWindow: payload.debug.filteredByCursorWindow,
        filteredInvisible: payload.debug.filteredInvisible,
        relaxedSeenUsed: payload.relaxedSeenUsed,
        fallbackAllPostsUsed: payload.fallbackAllPostsUsed,
        wrapAroundUsed: payload.wrapAroundUsed,
        emergencyFallbackUsed: payload.emergencyFallbackUsed,
        degradedFallbackUsed: payload.degradedFallbackUsed,
        exhausted: payload.exhausted,
        emptyReason: payload.emptyReason,
        cursorUsed: Boolean(query.cursor) && query.refresh !== true,
        noCursorRequest: payload.debug.noCursorRequest ?? (!query.cursor || query.refresh === true),
        nextCursorPresent: Boolean(payload.nextCursor),
        mediaReadyCount: payload.debug.mediaReadyCount,
        degradedMediaCount: payload.debug.degradedMediaCount,
        missingMediaFilteredCount: payload.debug.missingMediaFilteredCount,
        dbReads,
        queryCount: ctx?.dbOps.queries ?? 0,
        elapsedMs,
        anchor: payload.debug.randomSeedOrAnchor,
        deckHit: payload.debug.deckHit ?? false,
        deckSource: payload.debug.deckSource ?? "fallback",
        deckItemsBefore: payload.debug.deckItemsBefore ?? 0,
        deckItemsReturned: payload.debug.deckItemsReturned ?? payload.items.length,
        deckItemsAfter: payload.debug.deckItemsAfter ?? 0,
        deckRefillScheduled: payload.debug.deckRefillScheduled ?? false,
        deckRefillReason: payload.debug.deckRefillReason ?? null,
        servedRecentFiltered: payload.debug.servedRecentFiltered ?? 0,
        duplicateSuppressed: payload.debug.duplicateSuppressed ?? 0,
        repeatedFromRecentCount: payload.debug.repeatedFromRecentCount ?? 0,
        deckStarvationRefillUsed: payload.debug.deckStarvationRefillUsed ?? false,
        softServedRecentPicks: payload.debug.softServedRecentPicks ?? 0,
        firstPaintCardReadyCount: payload.debug.firstPaintCardReadyCount ?? payload.items.length,
        detailBatchRequiredForFirstPaint: payload.debug.detailBatchRequiredForFirstPaint ?? false,
        durableServedWriteStatus: payload.debug.durableServedWriteStatus ?? "skipped",
        ...videoSummary
      };

      const verboseFeedSummary = process.env.LOG_FEED_DEBUG_VERBOSE === "1";
      request.log.info(
        verboseFeedSummary
          ? summaryPayload
          : {
              event: summaryPayload.event,
              viewerId: summaryPayload.viewerId,
              requestedLimit: summaryPayload.requestedLimit,
              returnedCount: summaryPayload.returnedCount,
              elapsedMs: summaryPayload.elapsedMs,
              dbReads: summaryPayload.dbReads,
              queryCount: summaryPayload.queryCount,
              deckSource: summaryPayload.deckSource,
              deckHit: summaryPayload.deckHit,
              emergencyFallbackUsed: summaryPayload.emergencyFallbackUsed,
              detailBatchRequiredForFirstPaint: summaryPayload.detailBatchRequiredForFirstPaint,
              canonicalVideoPlayableCount: videoSummary.canonicalVideoPlayableCount ?? 0,
              canonicalStartupUrlCount: videoSummary.canonicalStartupUrlCount ?? 0,
              canonicalPosterCount: videoSummary.canonicalPosterCount ?? 0,
              canonicalGradientCount: videoSummary.canonicalGradientCount ?? 0,
              canonicalSelectedVariantCounts: videoSummary.canonicalSelectedVariantCounts ?? {},
              videoMissingPlayableCount: videoSummary.videoMissingPlayableCount ?? 0,
            },
        "feed for-you simple summary"
      );

      if (isFeedItemsMediaTraceEnabled()) {
        request.log.info(
          buildFeedItemsMediaTracePayload({
            surface: "feed.for_you_simple.get",
            viewerId,
            requestId: request.id,
            items: payload.items
          }),
          "feed items media trace (set LOCAVA_FEED_ITEMS_MEDIA_TRACE=1)"
        );
      }

      if (payload.emergencyFallbackUsed) {
        request.log.warn({ event: "feed_for_you_simple_emergency_fallback_used", viewerId, returnedCount: payload.items.length }, "feed for-you simple emergency fallback");
      }

      if (payload.debug.seenWriteAttempted && !payload.debug.seenWriteSucceeded) {
        request.log.warn(
          {
            event: "feed_for_you_simple_seen_write_failed",
            viewerId,
            returnedCount: payload.items.length
          },
          "feed for-you simple seen ledger write failed"
        );
      }
      return success({
        ...payload,
        debug: {
          ...payload.debug,
          dbReads,
          responseDbReads: dbReads,
          responseDbWrites: dbWrites,
          elapsedMs
        }
      });
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_simple_feed_cursor") {
        return reply.status(400).send(failure("invalid_cursor", "Cursor is invalid"));
      }
      if (!repository.isEnabled()) {
        return reply.status(503).send(failure("source_of_truth_required", "For You simple feed source unavailable"));
      }
      throw error;
    }
  });
}
