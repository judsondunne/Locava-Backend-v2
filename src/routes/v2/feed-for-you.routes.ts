import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { feedForYouContract, FeedForYouQuerySchema } from "../../contracts/surfaces/feed-for-you.contract.js";
import { setRouteName } from "../../observability/request-context.js";
import { failure, success } from "../../lib/response.js";
import { FeedForYouRepository } from "../../repositories/surfaces/feed-for-you.repository.js";
import { FeedForYouService } from "../../services/surfaces/feed-for-you.service.js";
import { FeedForYouOrchestrator } from "../../orchestration/surfaces/feed-for-you.orchestrator.js";

export async function registerV2FeedForYouRoutes(app: FastifyInstance): Promise<void> {
  const repository = new FeedForYouRepository();
  const service = new FeedForYouService(repository);
  const orchestrator = new FeedForYouOrchestrator(service);

  app.get(feedForYouContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    const query = FeedForYouQuerySchema.parse(request.query);
    setRouteName(feedForYouContract.routeName);
    const viewerId = query.viewerId?.trim() || viewer.viewerId;
    try {
      const startedAt = Date.now();
      const payload = await orchestrator.run({
        viewerId,
        limit: query.limit,
        cursor: query.cursor ?? null,
        debug: query.debug === "1" || query.debug === "true"
      });
      request.log.info(
        {
          event: "feed_for_you_fast_summary",
          requestId: payload.requestId,
          viewerId,
          latencyMs: Date.now() - startedAt,
          returnedCount: payload.items.length,
          reelCount: Number(payload.debug?.reelCount ?? 0),
          regularCount: Number(payload.debug?.regularCount ?? 0),
          recycledCount: Number(payload.debug?.recycledCount ?? 0),
          candidateDocsFetched:
            Number(payload.debug?.candidateWindowSizes?.reels ?? 0) +
            Number(payload.debug?.candidateWindowSizes?.regular ?? 0) +
            Number(payload.debug?.candidateWindowSizes?.regularFallback ?? 0),
          servedDocsChecked: Number(payload.debug?.servedCheckedCount ?? 0),
          servedDropped: Number(payload.debug?.servedDroppedCount ?? 0),
          budgetCapped: Boolean(payload.debug?.budgetCapped ?? false),
          servedWriteCount: Number(payload.debug?.servedWriteCount ?? 0),
          servedWriteOk: Boolean(payload.debug?.servedWriteOk ?? false),
          rankingVersion: String(payload.debug?.rankingVersion ?? "unknown")
        },
        "feed for-you summary"
      );
      return success(payload);
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_feed_for_you_cursor") {
        return reply.status(400).send(failure("invalid_cursor", "Feed cursor is invalid"));
      }
      if (error instanceof Error && error.message === "unsupported_feed_for_you_cursor_version") {
        return reply.status(400).send(failure("unsupported_cursor_version", "Feed cursor version is not supported"));
      }
      if (!repository.isEnabled()) {
        return reply.status(503).send(failure("source_of_truth_required", "For You feed source unavailable"));
      }
      throw error;
    }
  });
}
