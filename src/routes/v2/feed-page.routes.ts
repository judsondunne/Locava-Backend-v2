import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { feedPageContract, FeedPageQuerySchema } from "../../contracts/surfaces/feed-page.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { SourceOfTruthRequiredError } from "../../repositories/source-of-truth/strict-mode.js";
import { setRouteName } from "../../observability/request-context.js";
import { FeedPageOrchestrator } from "../../orchestration/surfaces/feed-page.orchestrator.js";
import { FeedRepository } from "../../repositories/surfaces/feed.repository.js";
import { FeedService } from "../../services/surfaces/feed.service.js";

function radiusLabelToKm(radiusLabel: string | undefined): number | undefined {
  if (!radiusLabel) return undefined;
  const normalized = radiusLabel.trim().toLowerCase();
  if (!normalized || normalized === "explore") return undefined;
  if (normalized === "nearby") return 5 * 1.60934;
  const match = /(\d+)\s*miles?/.exec(normalized);
  if (!match) return undefined;
  const miles = Number(match[1]);
  if (!Number.isFinite(miles) || miles <= 0) return undefined;
  return miles * 1.60934;
}

function isDevRuntime(): boolean {
  return (process.env.NODE_ENV ?? "development") !== "production";
}

class FeedSourceGuardError extends Error {}

function assertNoFakePagePayload(payload: Record<string, unknown>): void {
  const tokens = ["fake", "fallback", "demo", "placeholder", "synthetic", "seed", "internal-viewer-feed-post"];
  const fallbacks = Array.isArray(payload.fallbacks) ? payload.fallbacks.map((v) => String(v).toLowerCase()) : [];
  if (fallbacks.some((f) => tokens.some((t) => f.includes(t)))) {
    throw new FeedSourceGuardError("feed_page_forbidden_fallback_source");
  }
  const items = Array.isArray(payload.items) ? (payload.items as Array<Record<string, unknown>>) : [];
  for (const item of items) {
    const postId = String(item.postId ?? "").toLowerCase();
    if (tokens.some((t) => postId.includes(t))) {
      throw new FeedSourceGuardError("feed_page_forbidden_post_id");
    }
  }
}

function withPageDebug(
  payload: Record<string, unknown>,
  debug: {
    source: "backendv2_firestore";
    candidateCount: number;
    candidateReads: number;
    returnedCount: number;
    failureReason?: string;
    filterDropReasons?: Record<string, number>;
  }
): Record<string, unknown> {
  if (!isDevRuntime()) return payload;
  return {
    ...payload,
    debugFeedSource: debug.source,
    debugCandidateCount: debug.candidateCount,
    debugCandidateReads: debug.candidateReads,
    debugReturnedCount: debug.returnedCount,
    ...(debug.failureReason ? { debugFailureReason: debug.failureReason } : {}),
    ...(debug.filterDropReasons ? { debugFilterDropReasons: debug.filterDropReasons } : {})
  };
}

export async function registerV2FeedPageRoutes(app: FastifyInstance): Promise<void> {
  const repository = new FeedRepository();
  const service = new FeedService(repository);
  const orchestrator = new FeedPageOrchestrator(service);

  app.get(feedPageContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("homeFeed", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Home feed v2 surface is not enabled for this viewer"));
    }

    const query = FeedPageQuerySchema.parse(request.query);
    setRouteName(feedPageContract.routeName);

    try {
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        cursor: query.cursor ?? null,
        limit: query.limit,
        tab: query.tab,
        lat: query.lat,
        lng: query.lng,
        radiusKm: query.radiusKm ?? radiusLabelToKm(query.radiusLabel)
      });
      assertNoFakePagePayload(payload as unknown as Record<string, unknown>);
      if (payload.items.length === 0) {
        return reply.status(503).send(
          failure(
            "source_of_truth_required",
            "Feed page unavailable: no eligible backendv2 firestore posts",
            isDevRuntime()
              ? {
                  debugFeedSource: "backendv2_firestore",
                  debugFailureReason: "no_eligible_posts"
                }
              : undefined
          )
        );
      }
      return success(
        withPageDebug(payload as unknown as Record<string, unknown>, {
          source: "backendv2_firestore",
          candidateCount: payload.page.count,
          candidateReads: payload.page.count,
          returnedCount: payload.items.length
        })
      );
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_feed_cursor") {
        return reply.status(400).send(failure("invalid_cursor", "Feed cursor is invalid"));
      }
      if (error instanceof FeedSourceGuardError) {
        return reply.status(503).send(failure("source_of_truth_required", "Feed unavailable: fake source blocked"));
      }
      if (error instanceof SourceOfTruthRequiredError && error.sourceLabel.startsWith("feed_")) {
        return reply
          .status(503)
          .send(
            failure(
              "source_of_truth_required",
              `Feed unavailable: ${error.sourceLabel}`,
              isDevRuntime()
                ? {
                    debugFeedSource: "backendv2_firestore",
                    debugFailureReason: error.sourceLabel
                  }
                : undefined
            )
          );
      }
      throw error;
    }
  });
}
