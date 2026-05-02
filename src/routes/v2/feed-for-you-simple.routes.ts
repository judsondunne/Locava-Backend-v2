import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { feedForYouSimpleContract, FeedForYouSimpleQuerySchema } from "../../contracts/surfaces/feed-for-you-simple.contract.js";
import { failure, success } from "../../lib/response.js";
import { getRequestContext, setRouteName } from "../../observability/request-context.js";
import { FeedForYouSimpleRepository } from "../../repositories/surfaces/feed-for-you-simple.repository.js";
import { FeedForYouSimpleService } from "../../services/surfaces/feed-for-you-simple.service.js";

export async function registerV2FeedForYouSimpleRoutes(app: FastifyInstance): Promise<void> {
  const repository = new FeedForYouSimpleRepository();
  const service = new FeedForYouSimpleService(repository);

  app.get(feedForYouSimpleContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    const query = FeedForYouSimpleQuerySchema.parse(request.query);
    setRouteName(feedForYouSimpleContract.routeName);
    const viewerId = query.viewerId?.trim() || viewer.viewerId || null;

    try {
      const startedAt = Date.now();
      const payload = await service.getPage({
        viewerId,
        limit: query.limit,
        cursor: query.cursor ?? null
      });
      const ctx = getRequestContext();
      const dbReads = ctx?.dbOps.reads ?? 0;
      const dbWrites = ctx?.dbOps.writes ?? 0;
      const elapsedMs = Date.now() - startedAt;
      request.log.info(
        {
          event: "feed_for_you_simple_summary",
          viewerId,
          requestedLimit: query.limit,
          returnedCount: payload.items.length,
          cursorUsed: Boolean(query.cursor),
          nextCursorPresent: Boolean(payload.nextCursor),
          dbReads,
          elapsedMs,
          anchor: payload.debug.randomSeedOrAnchor
        },
        "feed for-you simple summary"
      );
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
