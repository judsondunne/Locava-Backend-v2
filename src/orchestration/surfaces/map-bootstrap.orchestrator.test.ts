import { describe, expect, it, vi } from "vitest";
import { MapBootstrapOrchestrator } from "./map-bootstrap.orchestrator.js";

describe("MapBootstrapOrchestrator", () => {
  it("returns real marker pages instead of a fake empty success payload", async () => {
    const loadBootstrap = vi.fn().mockResolvedValue({
      bounds: { minLng: -74.2, minLat: 40.6, maxLng: -73.8, maxLat: 40.9 },
      markers: [
        {
          markerId: "p1",
          postId: "p1",
          lat: 40.7,
          lng: -74,
          thumbUrl: "https://cdn/p1.jpg",
          mediaType: "image",
          ts: 123,
          activityIds: ["hike"],
          settingType: null
        }
      ],
      hasMore: false,
      nextCursor: null
    });
    const orchestrator = new MapBootstrapOrchestrator({
      parseBounds: vi.fn().mockReturnValue({ minLng: -74.2, minLat: 40.6, maxLng: -73.8, maxLat: 40.9 }),
      loadBootstrap
    } as never);

    const result = await orchestrator.run({
      viewerId: "map_bootstrap_orchestrator_test_viewer",
      bbox: "-74.2,40.6,-73.8,40.9",
      limit: 120
    });

    expect(result.page.count).toBe(1);
    expect(result.markers).toHaveLength(1);
    expect(result.markers[0]?.postId).toBe("p1");
    expect(loadBootstrap).toHaveBeenCalledTimes(1);
  });
});
