import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/source-of-truth/unexplored-read-firestore.adapter.js", () => ({
  getUnexploredSpotById: vi.fn(),
  getUnexploredRouteById: vi.fn(),
  getUnexploredTilesByKeys: vi.fn(),
  queryUnexploredSpotsByTileKey: vi.fn(),
  queryUnexploredRoutesByTileKey: vi.fn(),
}));

import {
  getUnexploredSpotById,
  getUnexploredTilesByKeys,
  queryUnexploredSpotsByTileKey,
} from "../../repositories/source-of-truth/unexplored-read-firestore.adapter.js";
import { resolveUnexploredItemById } from "./unexploredMapMarkerByIdResolver.js";
import { fetchUnexploredMapMarkerById } from "./unexploredMapMarkers.service.js";

const devSpotId = "dev_hartland_vt_hawk_mountain_overlook";
const lat = 43.5655;
const lng = -72.421;

describe("resolveUnexploredItemById", () => {
  beforeEach(() => {
    vi.mocked(getUnexploredSpotById).mockReset();
    vi.mocked(getUnexploredTilesByKeys).mockReset();
    vi.mocked(queryUnexploredSpotsByTileKey).mockReset();
  });

  it("returns firestore doc when present", async () => {
    vi.mocked(getUnexploredSpotById).mockResolvedValue({
      id: devSpotId,
      displayName: "Hawk Mountain Overlook",
      lat,
      lng,
    });

    const resolved = await resolveUnexploredItemById({ id: devSpotId, lat, lng });
    expect(resolved?.resolvedFrom).toBe("firestore_doc");
    expect(resolved?.id).toBe(devSpotId);
  });

  it("falls back to unexploredTiles when firestore doc is missing", async () => {
    vi.mocked(getUnexploredSpotById).mockResolvedValue(null);
    vi.mocked(getUnexploredTilesByKeys).mockResolvedValue([
      {
        tileKey: "13/1200/1500",
        z: 13,
        x: 1200,
        y: 1500,
        version: "v1",
        generatedAt: new Date().toISOString(),
        runId: "test",
        items: [
          {
            id: devSpotId,
            kind: "unexplored_spot",
            displayName: "Hawk Mountain Overlook",
            primaryActivity: "view",
            activities: ["view"],
            lat,
            lng,
            category: "viewpoint",
            displayPriority: "standard",
            sourceFamily: "openstreetmap",
            mapReadiness: "ready",
          },
        ],
      },
    ]);
    vi.mocked(queryUnexploredSpotsByTileKey).mockResolvedValue([]);

    const resolved = await resolveUnexploredItemById({ id: devSpotId, lat, lng });
    expect(resolved?.resolvedFrom).toBe("tile_doc");
    expect(resolved?.doc.displayName).toBe("Hawk Mountain Overlook");
    expect(resolved?.doc.lat).toBe(lat);
  });

  it("fetchUnexploredMapMarkerById resolves dev tile-only spot for claim-finalize", async () => {
    vi.mocked(getUnexploredSpotById).mockResolvedValue(null);
    vi.mocked(getUnexploredTilesByKeys).mockResolvedValue([
      {
        tileKey: "13/1200/1500",
        z: 13,
        x: 1200,
        y: 1500,
        version: "v1",
        generatedAt: new Date().toISOString(),
        runId: "test",
        items: [
          {
            id: devSpotId,
            kind: "unexplored_spot",
            displayName: "Hawk Mountain Overlook",
            primaryActivity: "view",
            activities: ["view"],
            lat,
            lng,
            category: "viewpoint",
            displayPriority: "standard",
            sourceFamily: "openstreetmap",
            mapReadiness: "ready",
          },
        ],
      },
    ]);
    vi.mocked(queryUnexploredSpotsByTileKey).mockResolvedValue([]);

    const marker = await fetchUnexploredMapMarkerById({
      id: devSpotId,
      lat,
      lng,
      itemType: "unexploredSpot",
      sourceCollection: "unexploredSpots",
    });

    expect(marker).not.toBeNull();
    expect(marker?.id).toBe(devSpotId);
    expect(marker?.title).toBe("Hawk Mountain Overlook");
    expect(marker?.lat).toBe(lat);
  });
});
