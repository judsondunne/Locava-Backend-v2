import type { FastifyInstance } from "fastify";
import { globalCache } from "../../cache/global-cache.js";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { loadEnv } from "../../config/env.js";
import { toMapMarkerCompactDTO } from "../../dto/compact-surface-dto.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName, recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import { mapMarkersContract, type MapMarkersResponse } from "../../contracts/surfaces/map-markers.contract.js";
import { MapMarkersFirestoreAdapter } from "../../repositories/source-of-truth/map-markers-firestore.adapter.js";
import { resolveMapMarkerLimit, clampMapRequestBounds, formatBoundsCsv, resolveMapMarkerIndexPageLimit } from "../../lib/map/map-marker-budgets.js";

const env = loadEnv();
const adapter = new MapMarkersFirestoreAdapter();

function ensureMarkerOpenPayload(marker: Record<string, unknown>): Record<string, unknown> {
  const existing = marker.openPayload;
  if (existing && typeof existing === "object") return existing as Record<string, unknown>;
  const postId = String(marker.postId ?? marker.id ?? "").trim();
  return {
    id: postId,
    postId,
    mediaType: marker.hasVideo === true ? "video" : "image",
    thumbUrl: marker.thumbnailUrl ?? null,
    displayPhotoLink: marker.thumbnailUrl ?? null,
    photoLink: marker.thumbnailUrl ?? null,
    userId: marker.ownerId ?? null,
    authorId: marker.ownerId ?? null,
    lat: marker.lat ?? null,
    lng: marker.lng ?? null,
    long: marker.lng ?? null,
    activity: marker.activity ?? null,
    activities: Array.isArray(marker.activities) ? marker.activities : [],
    visibility: marker.visibility ?? null,
    likeCount: 0,
    commentCount: 0,
    viewerHasLiked: false,
    viewerHasSaved: false,
    createdAtMs: Number(marker.createdAt ?? 0) || Date.now(),
    updatedAtMs: Number(marker.updatedAt ?? 0) || Date.now(),
    assets:
      typeof marker.thumbnailUrl === "string" && marker.thumbnailUrl.trim().length > 0
        ? [
            marker.hasVideo === true
              ? {
                  id: `${postId}:marker-video`,
                  type: "video",
                  poster: marker.thumbnailUrl,
                  thumbnail: marker.thumbnailUrl,
                  variants: {}
                }
              : {
                  id: `${postId}:marker-image`,
                  type: "image",
                  original: marker.thumbnailUrl,
                  thumbnail: marker.thumbnailUrl,
                  poster: marker.thumbnailUrl
                }
          ]
        : []
  };
}

export async function registerV2MapMarkersRoutes(app: FastifyInstance): Promise<void> {
  app.get(mapMarkersContract.path, async (request, reply) => {
    setRouteName(mapMarkersContract.routeName);
    const viewer = buildViewerContext(request);
    const query = mapMarkersContract.query.parse(request.query);
    const payloadMode = query.payloadMode ?? "compact";
    const markerIndexOnly = query.markerIndexOnly === true;
    let bbox = parseBounds(query.bbox);
    let bboxClamp: ReturnType<typeof clampMapRequestBounds> | null = null;
    if (bbox) {
      bboxClamp = clampMapRequestBounds(bbox);
      bbox = bboxClamp.bounds;
    }
    const bboxKeyForCache = bbox ? formatBoundsCsv(bbox) : query.bbox?.trim() ?? null;
    const ownerId = query.ownerId?.trim() || null;
    const includeNonPublic = Boolean(ownerId && viewer.viewerId === ownerId);
    const boundsApplied = Boolean(bbox && !ownerId);
    const isGlobal = !ownerId && !bbox;
    const isGlobalCompactIndex = isGlobal && payloadMode === "compact";
    const limitResolution =
      !isGlobal || payloadMode === "full"
        ? resolveMapMarkerLimit({
            requestedLimit: query.limit ?? null,
            configuredMaxDocs: env.MAP_MARKERS_MAX_DOCS,
            payloadMode
          })
        : null;
    const indexPageLimit = isGlobalCompactIndex
      ? resolveMapMarkerIndexPageLimit({
          requestedLimit: query.limit ?? null,
          configuredIndexPageMax: env.MAP_MARKERS_INDEX_PAGE_MAX_DOCS
        })
      : null;
    const hasExplicitLimit = (query.limit ?? null) != null;
    const limit = isGlobalCompactIndex ? indexPageLimit! : limitResolution!.effectiveLimit;
    const cacheKeyRoot = ownerId
      ? `map:markers:v2:owner:${includeNonPublic ? "self" : "public"}:${ownerId}`
      : bbox
        ? `map:markers:v2:bbox:${bboxKeyForCache}`
        : payloadMode === "full"
          ? "map:markers:v2:all"
          : `map:markers:v2:all:idx:${markerIndexOnly ? "1" : "0"}`;
    const configuredLimitForKey = limitResolution?.configuredLimit ?? env.MAP_MARKERS_INDEX_PAGE_MAX_DOCS;
    const indexHardCapApplied =
      isGlobalCompactIndex &&
      hasExplicitLimit &&
      typeof query.limit === "number" &&
      Number.isFinite(query.limit) &&
      Math.floor(query.limit) > limit;
    const cacheKeyRootWithLimit =
      isGlobalCompactIndex || ownerId || boundsApplied || !hasExplicitLimit || limit >= configuredLimitForKey
        ? cacheKeyRoot
        : `${cacheKeyRoot}:${limit}`;
    const cursorNonce = query.cursor?.trim() ? `cur:${query.cursor.trim().slice(0, 240)}` : "cur:start";
    const cacheKey = `${cacheKeyRootWithLimit}:${cursorNonce}:payload:${payloadMode}`;
    const ifNoneMatch = request.headers["if-none-match"];
    /** Cursor pages must always return JSON — clients paginate by parsing `hasMore`/`nextCursor`; a 304 has no body and can spin the same URL under HTTP caches. */
    const isCursorPage = Boolean(query.cursor?.trim());
    const cached = await globalCache.get<MapMarkersResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      if (
        ifNoneMatch &&
        String(ifNoneMatch).trim() === cached.etag &&
        !isCursorPage
      ) {
        request.log.info({ routeName: "map.markers.get", cacheSource: "revalidated_304" }, "map markers cache revalidated");
        reply.header("ETag", cached.etag);
        return reply.status(304).send();
      }
      request.log.info({ routeName: "map.markers.get", cacheSource: "hit", count: cached.count }, "map markers cache hit");
      reply.header("ETag", cached.etag);
      return success({
        ...cached,
        diagnostics: {
          ...cached.diagnostics,
          cacheSource: "hit",
          payloadMode: cached.diagnostics.payloadMode ?? "full"
        }
      });
    }
    recordCacheMiss();
    try {
      const includeOpenPayloadWire = !(markerIndexOnly && payloadMode === "compact");
      let nextCursor: string | null = null;
      let hasMoreMarkers = false;
      let dataset: import("../../repositories/source-of-truth/map-markers-firestore.adapter.js").MapMarkersDataset;
      if (ownerId) {
        dataset = await adapter.fetchByOwner({
          ownerId,
          maxDocs: limit,
          includeNonPublic,
          includeOpenPayload: includeOpenPayloadWire
        });
      } else if (bbox) {
        const windowDataset = await adapter.fetchWindow({
          maxDocs: limit,
          bounds: bbox,
          limit,
          includeOpenPayload: includeOpenPayloadWire
        });
        dataset = windowDataset;
        nextCursor = windowDataset.nextCursor ?? null;
        hasMoreMarkers = windowDataset.hasMore === true;
      } else {
        const globalDataset = await adapter.fetchAll({
          maxDocs: limit,
          includeOpenPayload: includeOpenPayloadWire,
          cursor: query.cursor ?? null
        });
        dataset = globalDataset;
        nextCursor = globalDataset.nextCursor ?? null;
        hasMoreMarkers = globalDataset.hasMore === true;
      }
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
                    openPayload: includeOpenPayloadWire
                      ? ensureMarkerOpenPayload(marker as Record<string, unknown>)
                      : null,
	              })
	            )
		          : dataset.markers.map((marker) => ({
              ...marker,
              openPayload: ensureMarkerOpenPayload(marker as Record<string, unknown>),
            }));
      let droppedNoMedia = 0;
      let droppedNoOpenPayload = 0;
      for (const m of markers as Array<{ thumbnailUrl?: unknown; openPayload?: unknown }>) {
        if (typeof m.thumbnailUrl !== "string" || !m.thumbnailUrl.trim()) droppedNoMedia += 1;
        if (includeOpenPayloadWire && (m.openPayload == null || typeof m.openPayload !== "object")) droppedNoOpenPayload += 1;
      }
      const clampNote = bboxClamp?.clamped === true ? "viewport_bbox_clamped" : null;
      const degradedReasonCombined =
        clampNote && dataset.degradedReason
          ? `${dataset.degradedReason}|${clampNote}`
          : clampNote ?? dataset.degradedReason ?? null;
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
              docsScanned: dataset.docsScanned,
              estimatedReads: dataset.readCount,
	          payloadBytes: Buffer.byteLength(JSON.stringify(markers), "utf8"),
	          invalidCoordinateDrops: dataset.invalidCoordinateDrops,
	          cacheSource: "miss",
	          payloadMode,
              requestedLimit: limitResolution?.requestedLimit ?? null,
              effectiveLimit: limit,
              candidateLimit: dataset.candidateLimit,
              ownerScoped: Boolean(ownerId),
              boundsApplied,
              hardCapApplied: (limitResolution?.hardCapApplied ?? false) || indexHardCapApplied,
              sourceQueryMode: dataset.sourceQueryMode,
              degradedReason: degradedReasonCombined,
              bboxKey: bboxKeyForCache,
              bboxArea: bboxClamp?.bboxArea ?? null,
              zoomBucket: bboxClamp?.zoomBucket ?? null,
              bboxClamped: bboxClamp?.clamped ?? false,
              pageCount: 1,
              nextCursor: ownerId ? null : nextCursor,
              hasMore: ownerId ? false : hasMoreMarkers,
              totalEligibleEstimate: null,
              droppedMissingCoords: dataset.invalidCoordinateDrops,
              droppedNoMedia,
              droppedNoOpenPayload,
              droppedByPolicy: 0,
              returnedMarkerCount: markers.length
	        }
	      };
      const ttlMs = Math.max(env.MAP_MARKERS_CACHE_TTL_MS, 120_000);
      await globalCache.set(cacheKey, payload, ttlMs);
      if (
        ifNoneMatch &&
        String(ifNoneMatch).trim() === payload.etag &&
        !isCursorPage
      ) {
        request.log.info({ routeName: "map.markers.get", cacheSource: "revalidated_304" }, "map markers immediate revalidated");
        reply.header("ETag", payload.etag);
        return reply.status(304).send();
      }
      request.log.info(
        {
	          routeName: "map.markers.get",
	          cacheSource: "miss",
	          count: payload.count,
              requestedLimit: limitResolution?.requestedLimit,
              effectiveLimit: limit,
              candidateLimit: payload.diagnostics.candidateLimit,
              docsScanned: payload.diagnostics.docsScanned,
              estimatedReads: payload.diagnostics.estimatedReads,
              boundsApplied,
              ownerScoped: Boolean(ownerId),
              hardCapApplied: (limitResolution?.hardCapApplied ?? false) || indexHardCapApplied,
	          payloadBytes: payload.diagnostics.payloadBytes,
	          invalidCoordinateDrops: payload.diagnostics.invalidCoordinateDrops,
              sourceQueryMode: payload.diagnostics.sourceQueryMode,
              degradedReason: payload.diagnostics.degradedReason
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

function parseBounds(rawBbox: string | undefined): {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
} | null {
  if (typeof rawBbox !== "string" || rawBbox.trim().length === 0) return null;
  const parts = rawBbox.split(",").map((value) => Number(value.trim()));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90 || minLng >= maxLng || minLat >= maxLat) {
    return null;
  }
  return { minLng, minLat, maxLng, maxLat };
}
