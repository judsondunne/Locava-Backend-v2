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
      docsScanned: 1,
      candidateLimit: 280,
      sourceQueryMode: "viewport_bounds",
      degradedReason: null,
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
      maxDocs: 280,
      includeOpenPayload: true
    });
    expect(result.markers).toHaveLength(1);
    const marker = result.markers[0]!;
    expect(marker).toMatchObject({
      markerId: "p1",
      postId: "p1",
      lat: 40.7,
      lng: -74,
      thumbUrl: null,
      mediaType: "video",
      ts: 200,
      activityIds: ["hike"],
      settingType: null
    });
    const envelope = marker.openPayload;
    expect(envelope).toBeDefined();
    expect(envelope).toMatchObject({
      postId: "p1",
      hydrationLevel: "marker",
      sourceRoute: "map.bootstrap",
      hasRawPost: false,
      debugPostEnvelope: expect.objectContaining({
        hydrationLevel: "marker",
        debugSource: "MapRepository.listMarkers_fallback"
      })
    });
    expect(envelope!.id).toBe("p1");
    expect(envelope!.rankToken).toBe(`post-${envelope!.postId}`);
  });
});
