import { describe, expect, it } from "vitest";
import { filterRoutesToStateBbox, unionBoundsForRoutes } from "./offroadRouteBounds.js";
import type { LocavaInventoryRoute } from "../inventoryLocavaTypes.js";

function route(lat: number, lng: number): LocavaInventoryRoute {
  return {
    id: "r",
    kind: "inventory_route",
    routeKind: "offroad_unmaintained_road",
    name: "test",
    normalizedName: "test",
    activity: "offroading",
    categories: [],
    activities: [],
    center: { lat, lng },
    bbox: { minLat: lat - 0.01, minLng: lng - 0.01, maxLat: lat + 0.01, maxLng: lng + 0.01 },
    distanceMeters: 100,
    distanceMiles: 0.1,
    distanceLabel: "0.1 mi",
    geometryType: "LineString",
    coordinates: [
      { lat, lng },
      { lat: lat + 0.001, lng: lng + 0.001 },
    ],
    source: "usfs_mvum",
    sourceType: "arcgis_feature",
    sourceId: "1",
    sourceKey: "k",
    sourceKeys: ["k"],
    memberWayIds: [],
    hasMedia: false,
    status: "active",
    locavaScore: 1,
    confidence: "high",
    displayPriority: "high",
    showAtZoom: 12,
    selectedTrailhead: null,
    selectedParking: null,
    parkingCandidates: [],
    trailheadCandidates: [],
    assemblyWarnings: [],
    classificationReason: "",
    tagSignals: [],
    negativeSignals: [],
    rejectionReason: null,
    tags: {},
    attribution: { provider: "t", license: "t" },
    importRunId: "t",
    createdAt: "",
    updatedAt: "",
  };
}

describe("offroadRouteBounds", () => {
  const ny = { minLat: 40.5, minLng: -79.76, maxLat: 45.02, maxLng: -71.86 };

  it("filters routes outside state bbox", () => {
    const inNy = route(43.0, -75.0);
    const inPa = route(39.5, -77.5);
    const filtered = filterRoutesToStateBbox([inNy, inPa], ny);
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.center.lat).toBe(43.0);
  });

  it("unionBoundsForRoutes computes extent", () => {
    const bounds = unionBoundsForRoutes([route(43.0, -75.0), route(44.0, -74.0)]);
    expect(bounds?.minLat).toBeLessThan(43.1);
    expect(bounds?.maxLat).toBeGreaterThan(43.9);
  });
});
