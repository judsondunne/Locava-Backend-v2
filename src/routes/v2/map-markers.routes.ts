import type { FastifyInstance } from "fastify";
import { globalCache } from "../../cache/global-cache.js";
import { loadEnv } from "../../config/env.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName, recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import { mapMarkersContract, type MapMarkersResponse } from "../../contracts/surfaces/map-markers.contract.js";
import { MapMarkersFirestoreAdapter } from "../../repositories/source-of-truth/map-markers-firestore.adapter.js";

const env = loadEnv();
const adapter = new MapMarkersFirestoreAdapter();

export async function registerV2MapMarkersRoutes(app: FastifyInstance): Promise<void> {
  app.get(mapMarkersContract.path, async (request, reply) => {
    setRouteName(mapMarkersContract.routeName);
    const query = mapMarkersContract.query.parse(request.query);
    const limit = Math.max(20, Math.min(400, Number(query.limit ?? 240) || 240));
    const cacheKey = `map:markers:v2:${limit}`;
    const ifNoneMatch = request.headers["if-none-match"];
    const cached = await globalCache.get<MapMarkersResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      if (ifNoneMatch && String(ifNoneMatch).trim() === cached.etag) {
        request.log.info({ routeName: "map.markers.get", cacheSource: "revalidated_304" }, "map markers cache revalidated");
        reply.header("ETag", cached.etag);
        return reply.status(304).send();
      }
      request.log.info({ routeName: "map.markers.get", cacheSource: "hit", count: cached.count }, "map markers cache hit");
      reply.header("ETag", cached.etag);
      return success({ ...cached, diagnostics: { ...cached.diagnostics, cacheSource: "hit" } });
    }
    recordCacheMiss();
    try {
      const dataset = await adapter.fetchAll({ maxDocs: Math.min(env.MAP_MARKERS_MAX_DOCS, limit) });
      const payload: MapMarkersResponse = {
        routeName: "map.markers.get",
        markers: dataset.markers,
        count: dataset.count,
        generatedAt: dataset.generatedAt,
        version: dataset.version,
        etag: dataset.etag,
        diagnostics: {
          queryCount: dataset.queryCount,
          readCount: dataset.readCount,
          payloadBytes: Buffer.byteLength(JSON.stringify(dataset.markers), "utf8"),
          invalidCoordinateDrops: dataset.invalidCoordinateDrops,
          cacheSource: "miss"
        }
      };
      await globalCache.set(cacheKey, payload, env.MAP_MARKERS_CACHE_TTL_MS);
      if (ifNoneMatch && String(ifNoneMatch).trim() === payload.etag) {
        request.log.info({ routeName: "map.markers.get", cacheSource: "revalidated_304" }, "map markers immediate revalidated");
        reply.header("ETag", payload.etag);
        return reply.status(304).send();
      }
      request.log.info(
        {
          routeName: "map.markers.get",
          cacheSource: "miss",
          count: payload.count,
          payloadBytes: payload.diagnostics.payloadBytes,
          invalidCoordinateDrops: payload.diagnostics.invalidCoordinateDrops
        },
        "map markers fetched"
      );
      reply.header("ETag", payload.etag);
      return success(payload);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return reply.status(503).send(
        failure("source_of_truth_required", "Map markers unavailable from Firestore source", {
          routeName: "map.markers.get",
          reason
        })
      );
    }
  });
}
