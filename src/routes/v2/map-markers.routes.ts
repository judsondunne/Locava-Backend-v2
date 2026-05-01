import type { FastifyInstance } from "fastify";
import { globalCache } from "../../cache/global-cache.js";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { loadEnv } from "../../config/env.js";
import { toMapMarkerCompactDTO } from "../../dto/compact-surface-dto.js";
import { failure, success } from "../../lib/response.js";
import { buildPostEnvelope } from "../../lib/posts/post-envelope.js";
import { setRouteName, recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import { mapMarkersContract, type MapMarkersResponse } from "../../contracts/surfaces/map-markers.contract.js";
import { MapMarkersFirestoreAdapter } from "../../repositories/source-of-truth/map-markers-firestore.adapter.js";

const env = loadEnv();
const adapter = new MapMarkersFirestoreAdapter();

function ensureMarkerOpenPayload(marker: Record<string, unknown>): Record<string, unknown> {
  const existing = marker.openPayload;
  if (existing && typeof existing === "object") return existing as Record<string, unknown>;
  const postId = String(marker.postId ?? marker.id ?? "").trim();
  return buildPostEnvelope({
    postId,
    seed: {
      postId,
      rankToken: `marker-${postId}`,
      media: {
        type: marker.hasVideo === true ? "video" : "image",
        posterUrl: String(marker.thumbnailUrl ?? "").trim(),
        aspectRatio: 1,
        startupHint: marker.hasVideo === true ? "poster_then_preview" : "poster_only",
      },
      social: { likeCount: 0, commentCount: 0 },
      viewer: { liked: false, saved: false },
      author: {
        userId: String(marker.ownerId ?? ""),
        handle: String(marker.ownerId ?? ""),
        name: null,
        pic: null,
      },
      createdAtMs: Number(marker.createdAt ?? 0) || Date.now(),
      updatedAtMs: Number(marker.updatedAt ?? 0) || Date.now(),
    },
    sourcePost: {
      postId,
      id: postId,
      mediaType: marker.hasVideo === true ? "video" : "image",
      thumbUrl: marker.thumbnailUrl ?? null,
      displayPhotoLink: marker.thumbnailUrl ?? null,
      ownerId: marker.ownerId ?? null,
      userId: marker.ownerId ?? null,
      lat: marker.lat ?? null,
      lng: marker.lng ?? null,
      activities: Array.isArray(marker.activities) ? marker.activities : [],
      visibility: marker.visibility ?? null,
    },
    hydrationLevel: "marker",
    sourceRoute: "map.markers.route_fallback",
  });
}

export async function registerV2MapMarkersRoutes(app: FastifyInstance): Promise<void> {
  app.get(mapMarkersContract.path, async (request, reply) => {
    setRouteName(mapMarkersContract.routeName);
    const viewer = buildViewerContext(request);
    const query = mapMarkersContract.query.parse(request.query);
    const payloadMode = query.payloadMode ?? "compact";
    const maxDocs = Math.min(env.MAP_MARKERS_MAX_DOCS, 10_000);
    const hasExplicitLimit = query.limit != null;
    const limit = hasExplicitLimit
      ? Math.max(20, Math.min(maxDocs, Number(query.limit) || maxDocs))
      : maxDocs;
    const ownerId = query.ownerId?.trim() || null;
    const includeNonPublic = Boolean(ownerId && viewer.viewerId === ownerId);
    const cacheKeyBase = ownerId
      ? `map:markers:v2:owner:${includeNonPublic ? "self" : "public"}:${ownerId}`
      : "map:markers:v2:all";
    const cacheKeyRoot =
      ownerId || !hasExplicitLimit || limit >= maxDocs ? cacheKeyBase : `${cacheKeyBase}:${limit}`;
    const cacheKey = `${cacheKeyRoot}:payload:${payloadMode}`;
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
      return success({
        ...cached,
        diagnostics: { ...cached.diagnostics, cacheSource: "hit", payloadMode: cached.diagnostics.payloadMode ?? "full" }
      });
    }
    recordCacheMiss();
    try {
      const dataset = ownerId
        ? await adapter.fetchByOwner({ ownerId, maxDocs: limit, includeNonPublic })
        : await adapter.fetchAll({ maxDocs: limit });
	      const markers =
	        payloadMode === "compact"
	          ? dataset.markers.map((marker) =>
              toMapMarkerCompactDTO({
                id: marker.id,
                postId: marker.postId,
                lat: marker.lat,
                lng: marker.lng,
                activity: marker.activity ?? null,
                activities: Array.isArray(marker.activities) ? marker.activities : [],
                createdAt: marker.createdAt ?? null,
                updatedAt: marker.updatedAt ?? null,
                visibility: marker.visibility ?? null,
                ownerId: marker.ownerId ?? null,
                thumbnailUrl: marker.thumbnailUrl ?? null,
                thumbKey: marker.thumbKey ?? null,
                followedUserPic: marker.followedUserPic ?? null,
                hasPhoto: marker.hasPhoto,
                hasVideo: marker.hasVideo,
              })
            )
	          : dataset.markers.map((marker) => ({
	              ...marker,
	              openPayload: ensureMarkerOpenPayload(marker as Record<string, unknown>),
	            }));
      const payload: MapMarkersResponse = {
        routeName: "map.markers.get",
        markers,
        count: dataset.count,
        generatedAt: dataset.generatedAt,
        version: dataset.version,
        etag: dataset.etag,
        diagnostics: {
          queryCount: dataset.queryCount,
          readCount: dataset.readCount,
          payloadBytes: Buffer.byteLength(JSON.stringify(markers), "utf8"),
          invalidCoordinateDrops: dataset.invalidCoordinateDrops,
          cacheSource: "miss",
          payloadMode
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
