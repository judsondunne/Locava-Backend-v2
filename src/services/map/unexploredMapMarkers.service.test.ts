import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/source-of-truth/unexplored-read-firestore.adapter.js", () => ({
  getUnexploredTilesByKeys: vi.fn(),
  queryUnexploredSpotsInBbox: vi.fn(),
  queryUnexploredRoutesInBbox: vi.fn(),
}));

import {
  getUnexploredTilesByKeys,
  queryUnexploredRoutesInBbox,
  queryUnexploredSpotsInBbox,
} from "../../repositories/source-of-truth/unexplored-read-firestore.adapter.js";
import { fetchUnexploredMapMarkerSummaries, fetchUnexploredSpotMarkerSummaries } from "./unexploredMapMarkers.service.js";

const bbox = { minLat: 43.5, minLng: -72.5, maxLat: 43.6, maxLng: -72.3 };

const sharedSpot = {
  id: "dev_hartland_vt_charles_dimmick_park",
  displayName: "Charles Dimmick Memorial Park",
  title: "Charles Dimmick Memorial Park",
  primaryActivity: "park",
  activities: ["park"],
  lat: 43.5406,
  lng: -72.3948,
  publicMapEligible: true,
  mapReadiness: "ready",
};

describe("fetchUnexploredMapMarkerSummaries", () => {
  beforeEach(() => {
    vi.mocked(getUnexploredTilesByKeys).mockReset();
    vi.mocked(queryUnexploredSpotsInBbox).mockReset();
    vi.mocked(queryUnexploredRoutesInBbox).mockReset();
  });

  it("dedupes the same spot from tiles and direct Firestore query", async () => {
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
            id: sharedSpot.id,
            kind: "unexplored_spot",
            displayName: sharedSpot.displayName,
            primaryActivity: "park",
            activities: ["park"],
            lat: sharedSpot.lat,
            lng: sharedSpot.lng,
            category: "park",
            displayPriority: "standard",
            sourceFamily: "openstreetmap",
            mapReadiness: "ready",
          },
        ],
      },
    ]);
    vi.mocked(queryUnexploredSpotsInBbox).mockResolvedValue([
      sharedSpot,
      {
        id: "unx_spot_029c790570cc",
        displayName: "Another spot",
        title: "Another spot",
        primaryActivity: "hiking",
        activities: ["hiking"],
        lat: 43.55,
        lng: -72.4,
        publicMapEligible: true,
        mapReadiness: "ready",
      },
    ]);
    vi.mocked(queryUnexploredRoutesInBbox).mockResolvedValue([]);

    const result = await fetchUnexploredMapMarkerSummaries({ bbox, zoom: 13, limit: 50 });

    expect(result.markers).toHaveLength(2);
    expect(result.fromTiles).toBe(1);
    expect(result.fromSpotsQuery).toBe(1);
    expect(result.markers.map((m) => m.id).sort()).toEqual([
      "dev_hartland_vt_charles_dimmick_park",
      "unx_spot_029c790570cc",
    ]);
  });

  it("fetchUnexploredSpotMarkerSummaries skips route Firestore query", async () => {
    vi.mocked(getUnexploredTilesByKeys).mockResolvedValue([]);
    vi.mocked(queryUnexploredSpotsInBbox).mockResolvedValue([sharedSpot]);
    vi.mocked(queryUnexploredRoutesInBbox).mockResolvedValue([]);

    const result = await fetchUnexploredSpotMarkerSummaries({ bbox, zoom: 13, limit: 50 });

    expect(result.markers).toHaveLength(1);
    expect(result.fromSpotsQuery).toBe(1);
    expect(queryUnexploredRoutesInBbox).not.toHaveBeenCalled();
    expect(result.markers[0]?.sourceCollection).toBe("unexploredSpots");
  });
});
