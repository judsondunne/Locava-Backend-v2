import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { feedForYouContract, FeedForYouQuerySchema } from "../../contracts/surfaces/feed-for-you.contract.js";
import { getRequestContext, setRouteName } from "../../observability/request-context.js";
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
      const dbOps = getRequestContext()?.dbOps ?? { reads: 0, writes: 0, queries: 0 };
      request.log.info(
        {
          event: "feed_for_you_queue_summary",
          requestId: payload.requestId,
          viewerId,
          engineVersion: payload.debug?.engineVersion ?? "queue-reels-v1",
          latencyMs: Date.now() - startedAt,
          returnedCount: payload.items.length,
          reelCount: Number(payload.debug?.reelCount ?? 0),
          regularCount: Number(payload.debug?.regularCount ?? 0),
          recycledRegularCount: Number(payload.debug?.recycledRegularCount ?? 0),
          reelQueueIndexBefore: Number(payload.debug?.reelQueueIndexBefore ?? 0),
          reelQueueIndexAfter: Number(payload.debug?.reelQueueIndexAfter ?? payload.feedState.reelQueueIndex ?? 0),
          reelQueueCount: Number(payload.feedState.reelQueueCount ?? 0),
          remainingReels: Number(payload.feedState.remainingReels ?? 0),
          feedStateCreated: Boolean(payload.debug?.feedStateCreated ?? false),
          feedStateWriteOk: Boolean(payload.debug?.feedStateWriteOk ?? false),
          servedWriteCount: Number(payload.debug?.servedWriteCount ?? 0),
          servedWriteOk: Boolean(payload.debug?.servedWriteOk ?? false),
          exhausted: Boolean(payload.exhausted ?? false),
          emptyReason: payload.debug?.emptyReason ?? null,
          reads: dbOps.reads,
          writes: dbOps.writes,
          queries: dbOps.queries
        },
        "feed for-you summary"
      );
      return success(payload);
    } catch (error) {
      if (!repository.isEnabled()) {
        return reply.status(503).send(failure("source_of_truth_required", "For You feed source unavailable"));
      }
      throw error;
    }
  });
}
