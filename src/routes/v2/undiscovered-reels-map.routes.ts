import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { undiscoveredReelsMapContract } from "../../contracts/surfaces/undiscovered-reels-map.contract.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import {
  fetchUndiscoveredReelsMapLayer,
  parseReelMapBbox,
} from "../../services/map/undiscoveredReelsMapLayer.service.js";

/**
 * GET /v2/map/layers/undiscovered-reels — bbox layer of geolocated IG reels with
 * thumbnail, creator, and playable URL. This is the read side Judson flagged as
 * missing; nothing else consumed `undiscoveredReels` before.
 */
export async function registerV2UndiscoveredReelsMapRoutes(app: FastifyInstance): Promise<void> {
  app.get(undiscoveredReelsMapContract.path, async (request, reply) => {
    setRouteName(undiscoveredReelsMapContract.routeName);
    buildViewerContext(request);

    const query = undiscoveredReelsMapContract.query.parse(request.query);
    const bbox = parseReelMapBbox(query.bbox);
    if (!bbox) {
      return reply
        .status(400)
        .send(failure("invalid_bbox", "bbox must be west,south,east,north with finite numbers"));
    }

    const result = await fetchUndiscoveredReelsMapLayer({
      bbox,
      limit: query.limit,
      playableOnly: query.playableOnly,
    });
    return success(result);
  });
}
