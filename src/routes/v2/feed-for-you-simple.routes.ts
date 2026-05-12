import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { feedForYouSimpleContract, FeedForYouSimpleQuerySchema } from "../../contracts/surfaces/feed-for-you-simple.contract.js";
import { failure, success } from "../../lib/response.js";
import { getRequestContext, setOrchestrationMetadata, setRouteName } from "../../observability/request-context.js";
import { FeedForYouSimpleRepository } from "../../repositories/surfaces/feed-for-you-simple.repository.js";
import { startForYouSimpleReelPoolWarmup } from "../../services/surfaces/feed-for-you-simple-reel-pool.js";
import { FeedForYouSimpleService } from "../../services/surfaces/feed-for-you-simple.service.js";
import {
  buildFeedItemsMediaTracePayload,
  isFeedItemsMediaTraceEnabled,
  rollupFeedCardMediaReadyCounts,
  rollupFeedVideoMediaSummary
} from "../../observability/feed-items-media-trace.js";

export async function registerV2FeedForYouSimpleRoutes(app: FastifyInstance): Promise<void> {
  const repository = new FeedForYouSimpleRepository();
  startForYouSimpleReelPoolWarmup(repository);
  const service = new FeedForYouSimpleService(repository);

  app.get(feedForYouSimpleContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    const query = FeedForYouSimpleQuerySchema.parse(request.query);
    setRouteName(feedForYouSimpleContract.routeName);
    const viewerId = query.viewerId?.trim() || viewer.viewerId || null;
    /**
     * Resolve radius filter from query.
     * - Default mode is "global" (legacy non-geo behavior; deck key/cursor unchanged).
     * - For "nearMe" / "custom", center + radiusMiles must be present and finite. Missing
     *   center silently falls back to "global" so an unselected dropdown never blocks the feed.
     */
    const radiusFilter: import("../../services/surfaces/feed-for-you-simple.service.js").ForYouRadiusFilter = (() => {
      const mode = query.radiusMode ?? "global";
      if (mode === "global") return { mode: "global", centerLat: null, centerLng: null, radiusMiles: null };
      const lat = typeof query.centerLat === "number" && Number.isFinite(query.centerLat) ? query.centerLat : null;
      const lng = typeof query.centerLng === "number" && Number.isFinite(query.centerLng) ? query.centerLng : null;
      const miles = typeof query.radiusMiles === "number" && Number.isFinite(query.radiusMiles) ? query.radiusMiles : null;
      if (lat == null || lng == null || miles == null) {
        request.log.warn(
          {
            event: "FOR_YOU_RADIUS_FILTER_IGNORED",
            radiusMode: mode,
            hasCenter: lat != null && lng != null,
            radiusMilesPresent: miles != null,
            reason: "missing_center_or_radius"
          },
          "for-you radius filter ignored (missing center/radius)"
        );
        return { mode: "global", centerLat: null, centerLng: null, radiusMiles: null };
      }
      return { mode, centerLat: lat, centerLng: lng, radiusMiles: miles };
    })();
    if (radiusFilter.mode !== "global") {
      request.log.info(
        {
          event: "RADIUS_FEED_REQUEST_PARSED",
          radiusMode: radiusFilter.mode,
          centerLat: radiusFilter.centerLat,
          centerLng: radiusFilter.centerLng,
          radiusMiles: radiusFilter.radiusMiles
        },
        "RADIUS_FEED_REQUEST_PARSED"
      );
    }
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
        refresh: query.refresh === true,
        radiusFilter
      });
      const ctx = getRequestContext();
      const dbReads = ctx?.dbOps.reads ?? 0;
      const dbWrites = ctx?.dbOps.writes ?? 0;
      const elapsedMs = Date.now() - startedAt;
      if (dbWrites > 0) {
        request.log.info(
          {
            event: "FEED_SEEN_LEDGER_WRITE_INTENTIONAL",
            viewerId,
            reason: "feedServedRecentRing",
            count: dbWrites,
            asyncOrBlocking: "async_deferred",
            note: "markPostsServedRecentForViewer scheduled via setTimeout(0); request handlers do not await commit",
          },
          "for-you served-recent short-term ledger write (intentional, bounded)"
        );
      }
      const videoSummary = rollupFeedVideoMediaSummary(payload.items) as Record<string, unknown>;
      const cardMediaSummary = rollupFeedCardMediaReadyCounts(payload.items) as Record<string, unknown>;

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
        coldRefillReason: payload.debug.coldRefillReason ?? null,
        staleDeckServed: payload.debug.staleDeckServed ?? false,
        refillDeferred: payload.debug.refillDeferred ?? false,
        paginationBudgetCapped: payload.debug.paginationBudgetCapped ?? false,
        candidateQueryCount: payload.debug.candidateQueryCount ?? 0,
        candidateReadCount: payload.debug.candidateReadCount ?? 0,
        payloadTrimMode: payload.debug.payloadTrimMode ?? null,
        firstPaintCardReadyCount: payload.debug.firstPaintCardReadyCount ?? payload.items.length,
        detailBatchRequiredForFirstPaint: payload.debug.detailBatchRequiredForFirstPaint ?? false,
        durableServedWriteStatus: payload.debug.durableServedWriteStatus ?? "skipped",
        ...videoSummary,
        ...cardMediaSummary
      };

      if (payload.emergencyFallbackUsed) {
        request.log.warn(
          {
            event: "FEED_EMERGENCY_FALLBACK_MEDIA_ENRICH_START",
            viewerId,
            postCount: payload.items.length
          },
          "feed emergency fallback media enrich start"
        );
        const stillLegacy = Number(cardMediaSummary.feedCardLegacyOnlyCount ?? 0);
        const postCt = Number(cardMediaSummary.feedCardPostCount ?? payload.items.length);
        const enrichedCount = Math.max(0, postCt - stillLegacy);
        request.log.warn(
          {
            event: "FEED_EMERGENCY_FALLBACK_MEDIA_ENRICH_READY",
            viewerId,
            postCount: postCt,
            enrichedCount,
            stillLegacyCount: stillLegacy,
            imageReadyCount: cardMediaSummary.feedCardImageReadyCount,
            videoStartupReadyCount: cardMediaSummary.feedCardVideoStartupReadyCount
          },
          "feed emergency fallback media enrich ready"
        );
      }

      request.log.info(
        {
          event: "FEED_CARD_MEDIA_READY_COUNTS",
          viewerId,
          postCount: cardMediaSummary.feedCardPostCount,
          imageReadyCount: cardMediaSummary.feedCardImageReadyCount,
          videoStartupReadyCount: cardMediaSummary.feedCardVideoStartupReadyCount,
          posterReadyCount: cardMediaSummary.feedCardPosterReadyCount,
          gradientReadyCount: cardMediaSummary.feedCardGradientReadyCount,
          legacyOnlyCount: cardMediaSummary.feedCardLegacyOnlyCount,
          legacyOnlyDetails: cardMediaSummary.feedCardLegacyOnlyDetails,
          mediaIncompleteCount: cardMediaSummary.feedCardMediaIncompleteCount,
          emergencyFallbackUsed: payload.emergencyFallbackUsed
        },
        "feed card media ready counts"
      );

      const legacyN = Number(cardMediaSummary.feedCardLegacyOnlyCount ?? 0);
      if (legacyN > 0) {
        request.log.warn(
          {
            event: "LEGACY_FALLBACK_UNAVOIDABLE",
            viewerId,
            count: legacyN,
            posts: cardMediaSummary.feedCardLegacyOnlyDetails ?? [],
          },
          "feed cards missing canonical in-apppost media fields"
        );
      }

      const isFirstPaintLog = !query.cursor || query.refresh === true;
      if (isFirstPaintLog) {
        request.log.info(
          {
            event: "FEED_FIRST_PAINT_BUDGET_DECISION",
            viewerId,
            source: payload.debug.deckSource ?? "unknown",
            readBudget: 15,
            queryBudget: 4,
            dbReads,
            queryCount: ctx?.dbOps.queries ?? 0,
            exceededBudget: dbReads > 15 || (ctx?.dbOps.queries ?? 0) > 4,
            returnedCount: payload.items.length,
            mediaReadyCount: payload.debug.mediaReadyCount ?? payload.items.length,
          },
          "feed first paint budget"
        );
      }

      try {
        const totalPayloadBytes = Buffer.byteLength(JSON.stringify(payload.items ?? []), "utf8");
        let mediaBytesEstimate = 0;
        let authorBytesEstimate = 0;
        for (const row of payload.items ?? []) {
          if (typeof row !== "object" || row === null) continue;
          const r = row as Record<string, unknown>;
          mediaBytesEstimate += Buffer.byteLength(JSON.stringify(r.appPostV2 ?? r.appPost ?? {}), "utf8");
          authorBytesEstimate += Buffer.byteLength(JSON.stringify(r.author ?? {}), "utf8");
        }
        const engagementBytesEstimate = Buffer.byteLength(
          JSON.stringify(
            (payload.items ?? []).map((row) =>
              typeof row === "object" && row
                ? { social: (row as { social?: unknown }).social, viewer: (row as { viewer?: unknown }).viewer }
                : {}
            )
          ),
          "utf8"
        );
        request.log.info(
          {
            event: "FEED_PAYLOAD_BREAKDOWN",
            postCount: payload.items.length,
            totalPayloadBytes,
            mediaBytesEstimate,
            authorBytesEstimate,
            engagementBytesEstimate,
            debugBytesEstimate: 0,
            gridDetailBytesEstimate: 0,
            trimMode: "feed_first_paint_slim_wire_v1"
          },
          "feed first paint payload sizing"
        );
      } catch {
        // sizing diagnostics must never break the handler
      }

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
