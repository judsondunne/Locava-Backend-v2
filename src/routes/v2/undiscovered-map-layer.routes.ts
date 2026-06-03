import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { loadEnv } from "../../config/env.js";
import { undiscoveredMapLayerContract } from "../../contracts/surfaces/undiscovered-map-layer.contract.js";
import { failure, success } from "../../lib/response.js";
import { recordCacheHit, recordCacheMiss, setRouteName } from "../../observability/request-context.js";
import {
  fetchUndiscoveredMapLayer,
  parseUndiscoveredLayerBbox,
} from "../../services/map/undiscoveredMapLayer.service.js";

const env = loadEnv();

export async function registerV2UndiscoveredMapLayerRoutes(app: FastifyInstance): Promise<void> {
  app.get(undiscoveredMapLayerContract.path, async (request, reply) => {
    setRouteName(undiscoveredMapLayerContract.routeName);
    buildViewerContext(request);

    if (!env.ENABLE_UNDISCOVERED_MAP_LAYER_V1) {
      return reply
        .status(404)
        .send(failure("not_found", "Undiscovered map layer v1 is not enabled"));
    }

    const query = undiscoveredMapLayerContract.query.parse(request.query);
    const bbox = parseUndiscoveredLayerBbox(query.bbox);
    if (!bbox) {
      return reply
        .status(400)
        .send(
          failure("invalid_bbox", "bbox must be west,south,east,north with finite numbers"),
        );
    }

    const { response, cacheHit } = await fetchUndiscoveredMapLayer({
      bbox,
      zoom: query.zoom,
      mode: query.mode,
      layerVersionHint: query.layerVersion ?? null,
    });

    if (cacheHit) recordCacheHit();
    else recordCacheMiss();

    if (response.etag) {
      reply.header("ETag", response.etag);
      const ifNoneMatch = request.headers["if-none-match"];
      if (typeof ifNoneMatch === "string" && ifNoneMatch === response.etag) {
        return reply.status(304).send();
      }
    }

    if (env.ENABLE_DEV_DIAGNOSTICS) {
      request.log.info(
        {
          event: "MAP_LAYER_UNDISCOVERED_V1_RESPONSE",
          layerId: response.layerId,
          layerVersion: response.layerVersion,
          counts: response.counts,
          payloadBytes: response.diagnostics?.payloadBytes,
          cacheHit: response.diagnostics?.cacheHit,
          docsScanned: response.diagnostics?.docsScanned,
          fetchMs: response.diagnostics?.fetchMs,
        },
        "undiscovered map layer v1",
      );
    }

    return reply.send(success(response));
  });
}
