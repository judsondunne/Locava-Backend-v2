import { describe, expect, it } from "vitest";
import {
  buildOffroadStateCatalog,
  buildOffroadPipelineSummary,
  DEFAULT_OFFROAD_MAIN_LIST_EXPORT_CONFIG,
  filterRoutesForMainListExport,
} from "./offroadPipelineConfig.js";
import type { LocavaInventoryRoute } from "../inventoryLocavaTypes.js";

function sampleRoute(overrides: Partial<LocavaInventoryRoute> = {}): LocavaInventoryRoute {
  return {
    id: "r1",
    kind: "inventory_route",
    routeKind: "offroad",
    name: "Test Route",
    normalizedName: "test route",
    activity: "offroading",
    categories: ["offroading"],
    activities: ["offroading"],
    center: { lat: 44, lng: -72 },
    bbox: { minLat: 43.9, minLng: -72.1, maxLat: 44.1, maxLng: -71.9 },
    distanceMeters: 1000,
    distanceMiles: 0.62,
    distanceLabel: "0.6 mi",
    geometryType: "LineString",
    coordinates: [
      { lat: 44, lng: -72 },
      { lat: 44.01, lng: -71.99 },
    ],
    source: "vtrans_public_highway_system",
    sourceType: "state_arcgis",
    sourceId: "1",
    sourceKey: "vt:test",
    sourceKeys: ["vt:test"],
    memberWayIds: [],
    hasMedia: false,
    status: "active",
    locavaScore: 85,
    confidence: "official_state",
    displayPriority: "primary",
    showAtZoom: 10,
    selectedTrailhead: null,
    selectedParking: null,
    parkingCandidates: [],
    trailheadCandidates: [],
    assemblyWarnings: [],
    classificationReason: "test",
    tagSignals: [],
    negativeSignals: [],
    rejectionReason: null,
    tags: {},
    attribution: { provider: "test", license: "test" },
    mapReadiness: "ready",
    offroad: {
      offroadCategory: "class_road",
      offroadConfidence: "explicit",
      accessStatus: "public",
      accessWarnings: [],
    },
    ...overrides,
  } as LocavaInventoryRoute;
}

describe("offroadPipelineConfig", () => {
  it("catalog covers all 50 states", () => {
    const catalog = buildOffroadStateCatalog();
    expect(catalog).toHaveLength(50);
    expect(catalog.every((s) => s.dryRunReady)).toBe(true);
    expect(catalog.filter((s) => s.setupTier === "federal_plus_state_official").map((s) => s.stateCode).sort()).toEqual([
      "NH",
      "VT",
    ]);
  });

  it("filters routes by export config", () => {
    const routes = [
      sampleRoute(),
      sampleRoute({
        sourceKey: "osm:1",
        source: "openstreetmap",
        locavaScore: 50,
      }),
    ];
    const result = filterRoutesForMainListExport(routes, DEFAULT_OFFROAD_MAIN_LIST_EXPORT_CONFIG);
    expect(result.summary.accepted).toBe(1);
    expect(result.rejected.some((r) => r.reason === "low_locava_score")).toBe(true);
  });

  it("pipeline summary is production-safe", () => {
    const summary = buildOffroadPipelineSummary();
    expect(summary.productionWritesBlocked).toBe(true);
    expect(summary.statesFederalOnly).toBeGreaterThan(40);
  });
});
