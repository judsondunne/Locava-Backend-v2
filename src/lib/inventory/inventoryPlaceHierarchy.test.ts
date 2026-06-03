import { describe, expect, it } from "vitest";
import { applyPlaceHierarchy } from "./inventoryPlaceHierarchy.js";
import type { LocavaInventoryRoute, LocavaInventorySpot } from "./inventoryLocavaTypes.js";

function spot(partial: Partial<LocavaInventorySpot> & Pick<LocavaInventorySpot, "id" | "name" | "category" | "sourceKey">): LocavaInventorySpot {
  return {
    kind: "inventory_spot",
    normalizedName: partial.name.toLowerCase(),
    categories: [partial.category],
    activities: [],
    lat: partial.lat ?? 43.54,
    lng: partial.lng ?? -72.39,
    bbox: partial.bbox ?? { minLat: 43.53, minLng: -72.4, maxLat: 43.55, maxLng: -72.38 },
    source: "openstreetmap",
    sourceType: "relation",
    sourceId: "1",
    hasMedia: false,
    status: "active",
    locavaScore: 80,
    confidence: "high",
    displayPriority: "high",
    showAtZoom: 12,
    classificationReason: "test",
    tagSignals: [],
    negativeSignals: [],
    rejectionReason: null,
    tags: partial.tags ?? {},
    attribution: { provider: "openstreetmap", license: "ODbL" },
    displayName: partial.displayName ?? partial.name,
    ...partial,
  };
}

describe("inventoryPlaceHierarchy", () => {
  it("parent park becomes parent_place", () => {
    const parent = spot({
      id: "p1",
      name: "Saint-Gaudens National Historical Park",
      displayName: "Saint-Gaudens National Historical Park",
      category: "park",
      sourceKey: "rel/1",
      tags: { boundary: "national_park", leisure: "park" },
    });
    const waterfall = spot({
      id: "w1",
      name: "Lower Falls",
      category: "waterfall",
      sourceKey: "node/2",
      lat: 43.5405,
      lng: -72.3895,
    });
    const result = applyPlaceHierarchy({
      spots: [parent, waterfall],
      routes: [],
      rawFeatures: [],
    });
    expect(result.spots.find((s) => s.id === "p1")?.placeKind).toBe("parent_place");
    expect(result.spots.find((s) => s.id === "w1")?.placeKind).toBe("child_feature");
    expect(result.spots.find((s) => s.id === "w1")?.parentPlaceName).toContain("Saint-Gaudens");
  });

  it("parent retains displayName", () => {
    const parent = spot({ id: "p1", name: "Saint-Gaudens National Historical Park", category: "park", sourceKey: "rel/1" });
    const result = applyPlaceHierarchy({ spots: [parent], routes: [], rawFeatures: [] });
    expect(result.spots[0]?.displayName).toBe("Saint-Gaudens National Historical Park");
  });

  it("child route gets parentPlaceName", () => {
    const parent = spot({
      id: "p1",
      name: "Big Park",
      category: "park",
      sourceKey: "rel/1",
      bbox: { minLat: 43.53, minLng: -72.4, maxLat: 43.55, maxLng: -72.38 },
    });
    const route: LocavaInventoryRoute = {
      id: "r1",
      kind: "inventory_route",
      routeKind: "single_way_segment",
      name: "Park Trail",
      normalizedName: "park trail",
      activity: "hiking",
      categories: ["hiking"],
      activities: ["hiking"],
      center: { lat: 43.5405, lng: -72.3895 },
      bbox: parent.bbox,
      distanceMeters: 500,
      distanceMiles: 0.31,
      distanceLabel: "0.3 mi",
      geometryType: "LineString",
      coordinates: [
        { lat: 43.5405, lng: -72.3895 },
        { lat: 43.541, lng: -72.388 },
      ],
      source: "openstreetmap",
      sourceType: "way",
      sourceId: "10",
      sourceKey: "way/10",
      sourceKeys: ["way/10"],
      memberWayIds: ["10"],
      hasMedia: false,
      status: "active",
      locavaScore: 70,
      confidence: "medium",
      displayPriority: "medium",
      showAtZoom: 14,
      selectedTrailhead: null,
      selectedParking: null,
      parkingCandidates: [],
      trailheadCandidates: [],
      assemblyWarnings: [],
      classificationReason: "test",
      tagSignals: [],
      negativeSignals: [],
      rejectionReason: null,
      tags: { highway: "path" },
      attribution: { provider: "openstreetmap", license: "ODbL" },
      importRunId: "run",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = applyPlaceHierarchy({ spots: [parent], routes: [route], rawFeatures: [] });
    expect(result.routes[0]?.parentPlaceName).toBe("Big Park");
  });
});
