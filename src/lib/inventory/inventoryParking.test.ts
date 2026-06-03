import { describe, expect, it } from "vitest";
import { attachSpotParking, shouldComputeSpotParking } from "./inventoryParking.js";
import type { LocavaInventorySpot } from "./inventoryLocavaTypes.js";

function spot(category: string, placeKind?: LocavaInventorySpot["placeKind"]): LocavaInventorySpot {
  return {
    id: "s1",
    kind: "inventory_spot",
    name: "Test",
    normalizedName: "test",
    category,
    categories: [category],
    activities: [],
    lat: 43.54,
    lng: -72.39,
    bbox: { minLat: 43.53, minLng: -72.4, maxLat: 43.55, maxLng: -72.38 },
    source: "openstreetmap",
    sourceType: "node",
    sourceId: "1",
    sourceKey: "node/1",
    hasMedia: false,
    status: "active",
    locavaScore: 70,
    confidence: "medium",
    displayPriority: "medium",
    showAtZoom: 14,
    classificationReason: "test",
    tagSignals: [],
    negativeSignals: [],
    rejectionReason: null,
    tags: {},
    attribution: { provider: "openstreetmap", license: "ODbL" },
    placeKind,
  };
}

describe("inventoryParking", () => {
  it("outdoor parent spot selects nearby public parking", () => {
    const { spots } = attachSpotParking({
      spots: [spot("park", "parent_place")],
      accessFeatures: [
        { lat: 43.5402, lng: -72.3898, name: "Lot A", sourceKey: "node/p1", tags: { amenity: "parking", access: "public" } },
      ],
    });
    expect(spots[0]?.parking?.hasParking).toBe(true);
  });

  it("cafe does not require parking computation", () => {
    expect(shouldComputeSpotParking(spot("cafe"))).toBe(false);
  });

  it("rejects private parking", () => {
    const { diagnostics } = attachSpotParking({
      spots: [spot("waterfall")],
      accessFeatures: [
        { lat: 43.5402, lng: -72.3898, name: "Private", sourceKey: "node/p2", tags: { amenity: "parking", access: "private" } },
      ],
    });
    expect(diagnostics.privateParkingRejected).toBe(1);
  });
});
