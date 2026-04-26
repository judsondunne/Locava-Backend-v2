import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { feedBootstrapContract, FeedBootstrapQuerySchema } from "../../contracts/surfaces/feed-bootstrap.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { FeedBootstrapOrchestrator } from "../../orchestration/surfaces/feed-bootstrap.orchestrator.js";
import { SourceOfTruthRequiredError } from "../../repositories/source-of-truth/strict-mode.js";
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

function assertNoFakeBootstrapPayload(payload: Record<string, unknown>): void {
  const tokens = ["fake", "fallback", "demo", "placeholder", "synthetic", "seed", "internal-viewer-feed-post"];
  const fallbacks = Array.isArray(payload.fallbacks) ? payload.fallbacks.map((v) => String(v).toLowerCase()) : [];
  if (fallbacks.some((f) => tokens.some((t) => f.includes(t)))) {
    throw new FeedSourceGuardError("feed_bootstrap_forbidden_fallback_source");
  }
  const firstRender = payload.firstRender as Record<string, unknown> | undefined;
  const feed = firstRender?.feed as Record<string, unknown> | undefined;
  const items = Array.isArray(feed?.items) ? (feed?.items as Array<Record<string, unknown>>) : [];
  for (const item of items) {
    const postId = String(item.postId ?? "").toLowerCase();
    if (tokens.some((t) => postId.includes(t))) {
      throw new FeedSourceGuardError("feed_bootstrap_forbidden_post_id");
    }
  }
}

function withBootstrapDebug(
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

export async function registerV2FeedBootstrapRoutes(app: FastifyInstance): Promise<void> {
  const repository = new FeedRepository();
  const service = new FeedService(repository);
  const orchestrator = new FeedBootstrapOrchestrator(service);

  app.get(feedBootstrapContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("homeFeed", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Home feed v2 surface is not enabled for this viewer"));
    }

    const query = FeedBootstrapQuerySchema.parse(request.query);
    setRouteName(feedBootstrapContract.routeName);

    try {
      const payload = await orchestrator.run({
        viewer,
        limit: query.limit,
        tab: query.tab,
        lat: query.lat,
        lng: query.lng,
        radiusKm: query.radiusKm ?? radiusLabelToKm(query.radiusLabel),
        debugSlowDeferredMs: query.debugSlowDeferredMs
      });
      assertNoFakeBootstrapPayload(payload as unknown as Record<string, unknown>);
      const items = payload.firstRender.feed.items;
      if (items.length === 0) {
        if (query.tab === "following") {
          return success(
            withBootstrapDebug(
              {
                ...payload,
                degraded: false,
                fallbacks: [...payload.fallbacks, "following_feed_empty_no_eligible_posts"],
                firstRender: {
                  ...payload.firstRender,
                  feed: {
                    ...payload.firstRender.feed,
                    page: {
                      ...payload.firstRender.feed.page,
                      count: 0,
                      nextCursor: null
                    },
                    items: []
                  }
                }
              } as unknown as Record<string, unknown>,
              {
                source: "backendv2_firestore",
                candidateCount: 0,
                candidateReads: 0,
                returnedCount: 0,
                failureReason: "following_feed_empty_no_eligible_posts"
              }
            )
          );
        }
        return reply.status(503).send(
          failure(
            "source_of_truth_required",
            "Feed unavailable: no eligible backendv2 firestore posts",
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
        withBootstrapDebug(payload as unknown as Record<string, unknown>, {
          source: "backendv2_firestore",
          candidateCount: payload.firstRender.feed.page.count,
          candidateReads: payload.firstRender.feed.page.count,
          returnedCount: items.length
        })
      );
    } catch (error) {
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
