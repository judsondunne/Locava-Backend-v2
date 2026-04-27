import { describe, expect, it, vi } from "vitest";
import { MapRepository } from "./map.repository.js";

describe("MapRepository", () => {
  it("builds truthful marker summaries from the marker universe adapter", async () => {
    const fetchWindow = vi.fn().mockResolvedValue({
      markers: [
        {
          id: "p1",
          postId: "p1",
          lat: 40.7,
          lng: -74,
          activity: "hike",
          activities: [],
          createdAt: 100,
          updatedAt: 200,
          visibility: "Public Spot",
          ownerId: "u1",
          thumbnailUrl: null,
          hasPhoto: false,
          hasVideo: true
        }
      ],
      count: 1,
      generatedAt: 123,
      version: "map-markers-v2",
      etag: "\"etag\"",
      queryCount: 1,
      readCount: 1,
      invalidCoordinateDrops: 0,
      hasMore: false,
      nextCursor: null
    });
    const repository = new MapRepository({ fetchWindow } as never);

    const result = await repository.listMarkers({
      bounds: { minLng: -75, minLat: 40, maxLng: -73, maxLat: 41 },
      limit: 120
    });

    expect(fetchWindow).toHaveBeenCalledWith({
      bounds: { minLng: -75, minLat: 40, maxLng: -73, maxLat: 41 },
      limit: 120,
      maxDocs: 5000
    });
    expect(result.markers).toEqual([
      {
        markerId: "p1",
        postId: "p1",
        lat: 40.7,
        lng: -74,
        thumbUrl: null,
        mediaType: "video",
        ts: 200,
        activityIds: ["hike"],
        settingType: null
      }
    ]);
  });
});
