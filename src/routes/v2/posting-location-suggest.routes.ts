import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  PostingLocationSuggestQuerySchema,
  postingLocationSuggestContract
} from "../../contracts/surfaces/posting-location-suggest.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { success, failure } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { SearchDiscoveryService } from "../../services/surfaces/search-discovery.service.js";

export async function registerV2PostingLocationSuggestRoutes(app: FastifyInstance): Promise<void> {
  const discovery = new SearchDiscoveryService();

  app.get(postingLocationSuggestContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("posting", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Posting v2 surface is not enabled for this viewer"));
    }

    setRouteName(postingLocationSuggestContract.routeName);
    const query = PostingLocationSuggestQuerySchema.parse(request.query);
    const q = String(query.q ?? "").trim();
    if (!q) {
      return success({ routeName: "posting.location_suggest.get", suggestions: [] });
    }

    const limit = Math.max(1, Math.min(12, Number(query.limit ?? 8) || 8));
    const rows = await discovery.loadLocationSuggestions(q, limit);

    const suggestions = rows.map((row) => ({
      text: row.text,
      type: row.cityRegionId ? ("town" as const) : ("state" as const),
      suggestionType: "place" as const,
      data: {
        locationText: row.text,
        ...(row.cityRegionId ? { cityRegionId: row.cityRegionId } : {}),
        stateRegionId: row.stateRegionId,
        stateName: row.stateName,
        lat: row.lat ?? null,
        lng: row.lng ?? null
      }
    }));

    return success({
      routeName: "posting.location_suggest.get",
      suggestions
    });
  });
}

