import type { MapMarkerSummary } from "../../contracts/entities/map-entities.contract.js";
import { MapMarkersFirestoreAdapter } from "../source-of-truth/map-markers-firestore.adapter.js";

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
      maxDocs: Math.max(180, input.limit * 2)
    });
    return {
      markers: page.markers.map((marker) => ({
        markerId: marker.id,
        postId: marker.postId,
        lat: marker.lat,
        lng: marker.lng,
        thumbUrl: marker.thumbnailUrl ?? "",
        mediaType: marker.hasVideo ? "video" : "image",
        ts: marker.createdAt ?? Date.now(),
        activityIds: marker.activities,
        settingType: "outdoor"
      })),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor
    };
  }
}

export const mapRepository = new MapRepository();
