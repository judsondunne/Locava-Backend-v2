import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { SearchActivityPostCountsService } from "../../services/surfaces/search-activity-post-counts.service.js";

const QuerySchema = z.object({
  activities: z.string().trim().min(1).max(4000),
});

export async function registerV2SearchActivityPostCountsRoutes(app: FastifyInstance): Promise<void> {
  const service = new SearchActivityPostCountsService();

  app.get("/v2/search/activity-post-counts", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Search v2 surface is not enabled for this viewer"));
    }
    setRouteName("search.activity_post_counts.get");
    const parsed = QuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send(failure("invalid_query", "Provide activities=comma,separated (max 40)"));
    }
    const activityList = parsed.data.activities
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 40);
    if (activityList.length === 0) {
      return reply.status(400).send(failure("invalid_query", "Provide at least one activity"));
    }
    try {
      const counts = await service.countsForActivities({ activities: activityList });
      return success({
        routeName: "search.activity_post_counts.get" as const,
        counts,
        scoringVersion: "activity_counts_v1",
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("unavailable")) {
        return reply.status(503).send(failure("source_of_truth_required", "Activity counts unavailable"));
      }
      request.log.warn(
        { event: "activity_post_counts_failed", error: error instanceof Error ? error.message : String(error) },
        "activity post counts failed",
      );
      return reply.status(503).send(failure("upstream_unavailable", "Activity counts temporarily unavailable"));
    }
  });
}
