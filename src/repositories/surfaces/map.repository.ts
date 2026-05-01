import type { MapMarkerSummary } from "../../contracts/entities/map-entities.contract.js";
import { loadEnv } from "../../config/env.js";
import { buildPostEnvelope } from "../../lib/posts/post-envelope.js";
import { MapMarkersFirestoreAdapter } from "../source-of-truth/map-markers-firestore.adapter.js";

const env = loadEnv();

export type MapBounds = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

export class MapRepositoryError extends Error {
  constructor(public readonly code: "invalid_bbox", message: string) {
    super(message);
  }
}

export class MapRepository {
  constructor(private readonly adapter: MapMarkersFirestoreAdapter = new MapMarkersFirestoreAdapter()) {}

  parseBounds(rawBbox: string): MapBounds {
    const parts = rawBbox.split(",").map((v) => Number(v.trim()));
    if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
      throw new MapRepositoryError("invalid_bbox", "Map bbox is invalid.");
    }
    const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
    if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90 || minLng >= maxLng || minLat >= maxLat) {
      throw new MapRepositoryError("invalid_bbox", "Map bbox bounds are invalid.");
    }
    return { minLng, minLat, maxLng, maxLat };
  }

  async listMarkers(input: { bounds: MapBounds; limit: number }): Promise<{
    markers: MapMarkerSummary[];
    hasMore: boolean;
    nextCursor: string | null;
  }> {
    const page = await this.adapter.fetchWindow({
      bounds: input.bounds,
      limit: input.limit,
      maxDocs: env.MAP_MARKERS_MAX_DOCS
    });
    return {
      markers: page.markers.map((marker) => ({
        markerId: marker.id,
        postId: marker.postId,
        lat: marker.lat,
        lng: marker.lng,
        thumbUrl: marker.thumbnailUrl ?? null,
        mediaType: marker.hasVideo ? "video" : "image",
        ts: marker.updatedAt ?? marker.createdAt ?? Date.now(),
        activityIds: uniqueStrings([...(marker.activities ?? []), ...(marker.activity ? [marker.activity] : [])]),
        settingType: null,
        openPayload: buildPostEnvelope({
          postId: marker.postId,
          seed: {
            postId: marker.postId,
            id: marker.postId,
            thumbUrl: marker.thumbnailUrl ?? null,
            displayPhotoLink: marker.thumbnailUrl ?? null,
            mediaType: marker.hasVideo ? "video" : "image",
            activities: uniqueStrings([...(marker.activities ?? []), ...(marker.activity ? [marker.activity] : [])]),
            lat: marker.lat,
            long: marker.lng,
            userId: marker.ownerId ?? null,
            authorId: marker.ownerId ?? null,
            visibility: marker.visibility ?? null,
            updatedAtMs: marker.updatedAt ?? marker.createdAt ?? Date.now(),
            createdAtMs: marker.createdAt ?? marker.updatedAt ?? Date.now(),
          },
          hydrationLevel: "marker",
          sourceRoute: "map.bootstrap",
          debugSource: "MapRepository.listMarkers",
        }),
      })),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor
    };
  }
}

export const mapRepository = new MapRepository();

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || out.includes(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}
